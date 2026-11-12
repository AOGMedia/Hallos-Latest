const CouponService = require('../services/couponService');
const CouponAnalyticsService = require('../services/couponAnalyticsService');

const couponService = new CouponService();
const analyticsService = new CouponAnalyticsService();

/**
 * Create a new coupon (admin - can create partner or creator coupons)
 * POST /api/admin/coupons/create
 */
exports.adminCreate = async (req, res) => {
  try {
    const {
      code,
      type,
      discountType,
      discountValue,
      partnerUserId,
      partnerCommissionPercent,
      creatorId,
      applicableContentTypes,
      specificContentIds,
      usageLimit,
      startsAt,
      expiresAt
    } = req.body;
    
    // Input validation
    if (!code || !type || !discountType || !discountValue || !applicableContentTypes) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: code, type, discountType, discountValue, applicableContentTypes'
      });
    }
    
    const validTypes = ['partner', 'creator'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Must be one of: partner, creator'
      });
    }
    
    const validDiscountTypes = ['percentage', 'flat'];
    if (!validDiscountTypes.includes(discountType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid discount type. Must be one of: percentage, flat'
      });
    }
    
    const validContentTypes = ['video', 'live_class', 'live_series'];
    if (!Array.isArray(applicableContentTypes) || !applicableContentTypes.every(ct => validContentTypes.includes(ct))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid applicable content types. Must be array of: video, live_class, live_series'
      });
    }
    
    const userId = req.user.id;
    
    const couponData = {
      code,
      type,
      discountType,
      discountValue: parseFloat(discountValue),
      partnerUserId: partnerUserId || null,
      partnerCommissionPercent: partnerCommissionPercent ? parseFloat(partnerCommissionPercent) : null,
      creatorId: creatorId || null,
      applicableContentTypes,
      specificContentIds: specificContentIds || null,
      status: 'active',
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      startsAt: startsAt || new Date(),
      expiresAt: expiresAt || null
    };
    
    const coupon = await couponService.createCoupon(couponData, userId, true);
    
    return res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      data: coupon
    });
    
  } catch (error) {
    console.error('[AdminCouponController] Create error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create coupon',
      error: error.message
    });
  }
};

/**
 * Get all coupons with filtering
 * GET /api/admin/coupons
 */
exports.getAllCoupons = async (req, res) => {
  try {
    const { status, type, contentType, creatorId } = req.query;
    
    const filters = {};
    if (status) filters.status = status;
    if (type) filters.type = type;
    if (contentType) filters.contentType = contentType;
    if (creatorId) filters.creatorId = creatorId;
    
    const coupons = await couponService.getAllCoupons(filters);
    
    return res.status(200).json({
      success: true,
      data: coupons
    });
    
  } catch (error) {
    console.error('[AdminCouponController] Get all coupons error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve coupons',
      error: error.message
    });
  }
};

/**
 * Update coupon (admin - can update any coupon)
 * PUT /api/admin/coupons/:id
 */
exports.adminUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;
    
    const coupon = await couponService.updateCoupon(id, updates, userId, true);
    
    return res.status(200).json({
      success: true,
      message: 'Coupon updated successfully',
      data: coupon
    });
    
  } catch (error) {
    console.error('[AdminCouponController] Update error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to update coupon',
      error: error.message
    });
  }
};

/**
 * Delete (deactivate) coupon (admin - can delete any coupon)
 * DELETE /api/admin/coupons/:id
 */
exports.adminDelete = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const coupon = await couponService.deactivateCoupon(id, userId, true);
    
    return res.status(200).json({
      success: true,
      message: 'Coupon deactivated successfully',
      data: coupon
    });
    
  } catch (error) {
    console.error('[AdminCouponController] Delete error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to deactivate coupon',
      error: error.message
    });
  }
};

/**
 * Get aggregate analytics
 * GET /api/admin/coupons/analytics
 */
exports.getAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, contentType, currency } = req.query;
    
    const filters = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (contentType) filters.contentType = contentType;
    if (currency) filters.currency = currency;
    
    const analytics = await analyticsService.getAggregateAnalytics(filters);
    
    // Also get top performing coupons
    const topCoupons = await analyticsService.getTopPerformingCoupons(10, {});
    
    return res.status(200).json({
      success: true,
      data: {
        aggregates: analytics,
        topPerformingCoupons: topCoupons
      }
    });
    
  } catch (error) {
    console.error('[AdminCouponController] Get analytics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve analytics',
      error: error.message
    });
  }
};

/**
 * Get coupon usage history with pagination
 * GET /api/admin/coupons/:id/usage-history
 */
exports.getUsageHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit } = req.query;
    
    const options = {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50
    };
    
    const result = await analyticsService.getCouponUsageHistory(id, options);
    
    return res.status(200).json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('[AdminCouponController] Get usage history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve usage history',
      error: error.message
    });
  }
};

/**
 * Permanently delete a coupon
 * DELETE /api/admin/coupons/:id/permanent
 *
 * Allowed when the coupon was never used, or when its end date has passed.
 * Before anything is removed, the coupon and every use of it are copied into
 * deleted_coupons, so sales and partner commission history can still be traced.
 * Purchases and freebie access keep their records with the coupon link cleared.
 * It all happens in one transaction: if any step fails, nothing changes.
 */
exports.adminHardDelete = async (req, res) => {
  const { QueryTypes } = require('sequelize');
  const sequelize = require('../config/db');
  const select = (sql, replacements, transaction) =>
    sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
  const run = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS deleted_coupons (
      id UUID PRIMARY KEY,
      code VARCHAR(100) NOT NULL,
      coupon JSONB NOT NULL,
      usages JSONB NOT NULL,
      usage_count INTEGER NOT NULL,
      deleted_by INTEGER NOT NULL,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const linkedTables = (await select(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'coupon_id'
          AND table_name IN ('purchases', 'freebie_access')`
    )).map((row) => row.table_name);

    const result = await sequelize.transaction(async (transaction) => {
      const [coupon] = await select('SELECT * FROM coupons WHERE id = :id FOR UPDATE', { id: req.params.id }, transaction);
      if (!coupon) return { status: 404, message: 'Coupon not found' };

      const usages = await select('SELECT * FROM coupon_usage WHERE coupon_id = :id', { id: coupon.id }, transaction);
      const hasEnded = coupon.status === 'expired' || (coupon.expires_at && new Date(coupon.expires_at) < new Date());
      if (usages.length > 0 && !hasEnded) {
        return {
          status: 409,
          message: `${coupon.code} is still running and has been used. Turn it off now, or delete it after its end date.`,
        };
      }

      await run(
        `INSERT INTO deleted_coupons (id, code, coupon, usages, usage_count, deleted_by)
         VALUES (:id, :code, CAST(:coupon AS JSONB), CAST(:usages AS JSONB), :count, :deletedBy)
         ON CONFLICT (id) DO NOTHING`,
        {
          id: coupon.id,
          code: coupon.code,
          coupon: JSON.stringify(coupon),
          usages: JSON.stringify(usages),
          count: usages.length,
          deletedBy: req.user.id,
        },
        transaction
      );
      for (const table of linkedTables) {
        await run(`UPDATE ${table} SET coupon_id = NULL WHERE coupon_id = :id`, { id: coupon.id }, transaction);
      }
      await run('DELETE FROM coupon_usage WHERE coupon_id = :id', { id: coupon.id }, transaction);
      await run('DELETE FROM coupon_audit_log WHERE coupon_id = :id', { id: coupon.id }, transaction);
      await run('DELETE FROM coupons WHERE id = :id', { id: coupon.id }, transaction);
      return { status: 200, code: coupon.code, uses: usages.length };
    });

    if (result.status !== 200) {
      return res.status(result.status).json({ success: false, message: result.message });
    }
    console.log(`[Admin Coupon] Coupon ${result.code} (${req.params.id}, ${result.uses} uses archived) permanently deleted by user ${req.user.id}`);
    return res.status(200).json({ success: true, message: 'Coupon deleted', archivedUses: result.uses });
  } catch (error) {
    console.error('[Admin Coupon] Hard delete error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete coupon. Nothing was changed.' });
  }
};
