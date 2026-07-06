const crypto = require('crypto');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../config/db');
const ReferralCode = require('../models/ReferralCode');
const UserReferral = require('../models/UserReferral');
const ReferralCommission = require('../models/ReferralCommission');
const User = require('../models/User');

class ReferralService {
  /**
   * Generate a random uppercase alphanumeric string 8–12 chars using crypto.
   * @returns {string}
   */
  generateUniqueCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = 8 + (crypto.randomInt(5)); // 8–12
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars[crypto.randomInt(chars.length)];
    }
    return code;
  }

  /**
   * Generate a unique code that doesn't collide with existing DB records.
   * Retries up to 10 times.
   * @returns {Promise<string>}
   */
  async _generateUniqueCodeWithRetry() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = this.generateUniqueCode();
      const existing = await ReferralCode.findOne({ where: { referralCode: code } });
      if (!existing) return code;
    }
    throw new Error('Failed to generate a unique referral code after 10 attempts');
  }

  /**
   * Create a new referral code for a partner.
   */
  async createReferralCode({ partnerUserId, commissionPercent, label, expiresAt, createdBy }) {
    // Validate required fields
    if (!partnerUserId || commissionPercent == null || !label) {
      const err = new Error('partnerUserId, commissionPercent, and label are required');
      err.statusCode = 400;
      throw err;
    }

    const percent = parseFloat(commissionPercent);
    if (isNaN(percent) || percent < 0.01 || percent > 99.99) {
      const err = new Error('commissionPercent must be between 0.01 and 99.99');
      err.statusCode = 400;
      throw err;
    }

    // Default expiresAt to 3 months from now
    const resolvedExpiresAt = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 3 * 30 * 24 * 60 * 60 * 1000);

    const code = await this._generateUniqueCodeWithRetry();

    const record = await ReferralCode.create({
      referralCode: code,
      label,
      partnerUserId,
      commissionPercent: percent,
      expiresAt: resolvedExpiresAt,
      status: 'active',
      createdBy
    });

    const signupLink = `${process.env.CLIENT_URL}/signup?ref=${code}`;
    return { ...record.toJSON(), signupLink };
  }

  /**
   * Update a referral code. Handles cascade side-effects.
   */
  async updateReferralCode(codeId, updates, adminUserId) {
    const record = await ReferralCode.findByPk(codeId);
    if (!record) {
      const err = new Error('Referral code not found');
      err.statusCode = 404;
      throw err;
    }

    const allowedFields = ['label', 'commissionPercent', 'expiresAt', 'status'];
    const patch = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) patch[field] = updates[field];
    }

    if (patch.commissionPercent !== undefined) {
      const percent = parseFloat(patch.commissionPercent);
      if (isNaN(percent) || percent < 0.01 || percent > 99.99) {
        const err = new Error('commissionPercent must be between 0.01 and 99.99');
        err.statusCode = 400;
        throw err;
      }
      patch.commissionPercent = percent;
    }

    const wasExpired = record.status === 'expired';
    const newStatus = patch.status;
    const newExpiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;

    await record.update(patch);

    // Side effect: deactivate → set commission_active = false on all linked UserReferrals
    if (newStatus === 'inactive') {
      await UserReferral.update(
        { commissionActive: false },
        { where: { referralCodeId: codeId } }
      );
    }

    // Side effect: expiresAt extended past now on an expired code → reactivate
    if (wasExpired && newExpiresAt && newExpiresAt > new Date()) {
      await record.update({ status: 'active' });
      await UserReferral.update(
        { commissionActive: true },
        { where: { referralCodeId: codeId } }
      );
    }

    return record.reload();
  }

  /**
   * List all referral codes with optional status filter and aggregates.
   */
  async listReferralCodes({ status, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (status) where.status = status;

    const { count, rows } = await ReferralCode.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
      attributes: {
        include: [
          [
            literal(`(SELECT COUNT(*) FROM user_referrals WHERE user_referrals.referral_code_id = "ReferralCode"."id")`),
            'totalLinkedCreators'
          ],
          [
            literal(`(SELECT COALESCE(SUM(rc.commission_amount), 0) FROM referral_commissions rc WHERE rc.referral_code = "ReferralCode"."referral_code")`),
            'totalCommissionsPaid'
          ]
        ]
      }
    });

    const data = rows.map(r => {
      const json = r.toJSON();
      json.signupLink = `${process.env.CLIENT_URL}/signup?ref=${r.referralCode}`;
      return json;
    });

    return { total: count, data };
  }

  /**
   * Get creators linked to a specific referral code.
   */
  async getCreatorsForCode(codeId, { limit = 20, offset = 0 } = {}) {
    const { count, rows } = await UserReferral.findAndCountAll({
      where: { referralCodeId: codeId },
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ]
    });

    const data = rows.map(r => ({
      creatorUserId: r.creatorUserId,
      firstname: r.creator ? r.creator.firstname : null,
      lastname: r.creator ? r.creator.lastname : null,
      email: r.creator ? r.creator.email : null,
      signedUpAt: r.signedUpAt,
      commissionActive: r.commissionActive
    }));

    return { total: count, data };
  }

  /**
   * Get commission history for a partner with optional filters.
   */
  async getPartnerCommissions(partnerUserId, { currency, startDate, endDate, limit = 20, offset = 0 } = {}) {
    // partnerUserId is optional for admin — if not provided, return all commissions
    const where = {};
    if (partnerUserId) where.referrerUserId = parseInt(partnerUserId);
    if (currency) where.currency = currency;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await ReferralCommission.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return { total: count, commissions: rows };
  }

  /**
   * Link a creator to a referral code at signup. Never throws.
   */
  async linkCreatorAtSignup(creatorUserId, refCode) {
    try {
      const now = new Date();
      const code = await ReferralCode.findOne({
        where: {
          referralCode: refCode,
          status: 'active',
          expiresAt: { [Op.gt]: now }
        }
      });

      if (!code) return;

      await UserReferral.create({
        creatorUserId,
        referralCodeId: code.id,
        referralCode: code.referralCode,
        partnerUserId: code.partnerUserId,
        signedUpAt: now,
        commissionActive: true
      });

      // Increment successful_referrals counter on the code
      await code.increment('successfulReferrals');
    } catch (err) {
      // Unique constraint violation (creator already linked) — silent
      if (err.name === 'SequelizeUniqueConstraintError') return;
      console.error('[ReferralService] linkCreatorAtSignup error (non-critical):', err.message);
    }
  }

  /**
   * Get a partner's referral code with signup link.
   */
  async getPartnerReferralCode(partnerUserId) {
    const record = await ReferralCode.findOne({ where: { partnerUserId } });
    if (!record) return null;
    return {
      ...record.toJSON(),
      signupLink: `${process.env.CLIENT_URL}/signup?ref=${record.referralCode}`
    };
  }

  /**
   * Get partner stats: creators referred, commissions earned, history.
   */
  async getPartnerStats(partnerUserId, { limit = 20, offset = 0 } = {}) {
    const [totalCreatorsResult, totalCommissionsResult, { count, rows }] = await Promise.all([
      UserReferral.count({ where: { partnerUserId } }),
      ReferralCommission.findOne({
        where: { referrerUserId: partnerUserId },
        attributes: [[fn('SUM', col('commission_amount')), 'total']],
        raw: true
      }),
      ReferralCommission.findAndCountAll({
        where: { referrerUserId: partnerUserId },
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      })
    ]);

    return {
      totalCreatorsReferred: totalCreatorsResult,
      totalCommissionsEarned: totalCommissionsResult ? (totalCommissionsResult.total || '0.00') : '0.00',
      commissionHistory: { total: count, items: rows }
    };
  }

  /**
   * Expire all active codes whose expiresAt has passed.
   */
  async processExpiredCodes() {
    const now = new Date();
    const expiredCodes = await ReferralCode.findAll({
      where: {
        status: 'active',
        expiresAt: { [Op.lte]: now }
      }
    });

    let expiredCount = 0;
    const errors = [];

    for (const code of expiredCodes) {
      try {
        await sequelize.transaction(async (t) => {
          await code.update({ status: 'expired' }, { transaction: t });
          await UserReferral.update(
            { commissionActive: false },
            { where: { referralCodeId: code.id }, transaction: t }
          );
        });
        expiredCount++;
      } catch (err) {
        console.error(`[ReferralService] processExpiredCodes error for code ${code.id}:`, err.message);
        errors.push({ codeId: code.id, error: err.message });
      }
    }

    return { expiredCount, errors };
  }
}

module.exports = new ReferralService();
