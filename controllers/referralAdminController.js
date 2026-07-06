const referralService = require('../services/referralService');

/**
 * Referral Admin Controller
 * Admin-managed partner referral program endpoints.
 */

/**
 * POST /api/admin/referral/codes
 * Create a new referral code for a partner.
 */
exports.createCode = async (req, res) => {
  try {
    const { partnerUserId, commissionPercent, label, expiresAt } = req.body;
    const result = await referralService.createReferralCode({
      partnerUserId,
      commissionPercent,
      label,
      expiresAt,
      createdBy: req.user.id
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('[ReferralAdmin] createCode error:', err);
    const status = err.statusCode === 400 ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/admin/referral/codes/:id
 * Update a referral code.
 */
exports.updateCode = async (req, res) => {
  try {
    const result = await referralService.updateReferralCode(req.params.id, req.body, req.user.id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error('[ReferralAdmin] updateCode error:', err);
    if (err.statusCode === 404) return res.status(404).json({ success: false, message: err.message });
    if (err.statusCode === 400) return res.status(400).json({ success: false, message: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/referral/codes
 * List all referral codes with optional status filter.
 */
exports.listCodes = async (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const result = await referralService.listReferralCodes({ status, limit, offset });
    return res.status(200).json({ success: true, total: result.total, data: result.data });
  } catch (err) {
    console.error('[ReferralAdmin] listCodes error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/referral/codes/:id/creators
 * List creators linked to a referral code.
 */
exports.getCreators = async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const result = await referralService.getCreatorsForCode(req.params.id, { limit, offset });
    return res.status(200).json({ success: true, total: result.total, data: result.data });
  } catch (err) {
    console.error('[ReferralAdmin] getCreators error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/referral/commissions
 * Commission history with optional filters.
 */
exports.getCommissions = async (req, res) => {
  try {
    const { partnerUserId, currency, startDate, endDate, limit, offset } = req.query;
    const result = await referralService.getPartnerCommissions(partnerUserId, {
      currency,
      startDate,
      endDate,
      limit,
      offset
    });
    return res.status(200).json({ success: true, total: result.total, data: result.commissions });
  } catch (err) {
    console.error('[ReferralAdmin] getCommissions error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
