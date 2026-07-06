const CouponService = require('../services/couponService');
const CouponAnalyticsService = require('../services/couponAnalyticsService');

const couponService = new CouponService();
const analyticsService = new CouponAnalyticsService();

/**
 * Validate coupon for a specific purchase
 * POST /api/coupons/validate
 */
exports.validate = async (req, res) => {
  try {
    const { code, contentType, contentId } = req.body;
    
    // Input validation
    if (!code || !contentType || !contentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: code, contentType, contentId'
      });
    }
    
    const validContentTypes = ['video', 'live_class', 'live_series'];
    if (!validContentTypes.includes(contentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content type. Must be one of: video, live_class, live_series'
      });
    }
    
    const userId = req.user.id;
    
    const result = await couponService.validateCoupon(code, contentType, contentId, userId);
    
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }
    
    return res.status(200).json({
      success: true,
      data: {
        coupon: result.coupon,
        originalPrice: result.originalPrice,
        currency: result.currency,
        discountAmount: result.discountAmount,
        finalPrice: result.finalPrice,
        partnerCommission: result.partnerCommission
      }
    });
    
  } catch (error) {
    console.error('[CouponController] Validate error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to validate coupon',
      error: error.message
    });
  }
};

/**
 * Create a new coupon (creator only)
 * POST /api/coupons/create
 */
exports.create = async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      applicableContentTypes,
      specificContentIds,
      usageLimit,
      startsAt,
      expiresAt
    } = req.body;
    
    // Input validation
    if (!code || !discountType || !discountValue || !applicableContentTypes) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: code, discountType, discountValue, applicableContentTypes'
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
      type: 'creator',
      discountType,
      discountValue: parseFloat(discountValue),
      creatorId: userId,
      applicableContentTypes,
      specificContentIds: specificContentIds || null,
      status: 'active',
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      startsAt: startsAt || new Date(),
      expiresAt: expiresAt || null
    };
    
    const coupon = await couponService.createCoupon(couponData, userId, false);
    
    return res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      data: coupon
    });
    
  } catch (error) {
    console.error('[CouponController] Create error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create coupon',
      error: error.message
    });
  }
};

/**
 * Get creator's coupons
 * GET /api/coupons/my-coupons
 */
exports.getMyCoupons = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, contentType } = req.query;
    
    const filters = {};
    if (status) filters.status = status;
    if (contentType) filters.contentType = contentType;
    
    const coupons = await couponService.getCreatorCoupons(userId, filters);
    
    return res.status(200).json({
      success: true,
      data: coupons
    });
    
  } catch (error) {
    console.error('[CouponController] Get my coupons error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve coupons',
      error: error.message
    });
  }
};

/**
 * Update coupon
 * PUT /api/coupons/:id
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;
    
    const coupon = await couponService.updateCoupon(id, updates, userId, false);
    
    return res.status(200).json({
      success: true,
      message: 'Coupon updated successfully',
      data: coupon
    });
    
  } catch (error) {
    console.error('[CouponController] Update error:', error);
    
    if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    
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
 * Delete (deactivate) coupon
 * DELETE /api/coupons/:id
 */
exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const coupon = await couponService.deactivateCoupon(id, userId, false);
    
    return res.status(200).json({
      success: true,
      message: 'Coupon deactivated successfully',
      data: coupon
    });
    
  } catch (error) {
    console.error('[CouponController] Delete error:', error);
    
    if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    
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
 * Get coupon usage statistics
 * GET /api/coupons/:id/usage
 */
exports.getUsage = async (req, res) => {
  try {
    const { id } = req.params;
    
    const statistics = await analyticsService.getCouponStatistics(id);
    
    return res.status(200).json({
      success: true,
      data: statistics
    });
    
  } catch (error) {
    console.error('[CouponController] Get usage error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve coupon usage',
      error: error.message
    });
  }
};
