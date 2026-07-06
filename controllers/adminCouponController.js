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
