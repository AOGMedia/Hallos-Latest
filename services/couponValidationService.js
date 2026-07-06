const Coupon = require('../models/Coupon');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');

class CouponValidationService {
  /**
   * Validate coupon code format
   */
  validateCodeFormat(code) {
    if (!code || typeof code !== 'string') {
      throw new Error('Coupon code is required');
    }
    
    const trimmedCode = code.trim();
    
    if (trimmedCode.length < 3 || trimmedCode.length > 50) {
      throw new Error('Coupon code must be between 3 and 50 characters');
    }
    
    if (!/^[A-Z0-9-]+$/i.test(trimmedCode)) {
      throw new Error('Coupon code must contain only alphanumeric characters and hyphens');
    }
    
    // Check for offensive words (basic blocklist)
    const blocklist = ['FUCK', 'SHIT', 'DAMN', 'BITCH', 'ASSHOLE', 'BASTARD'];
    const upperCode = trimmedCode.toUpperCase();
    for (const word of blocklist) {
      if (upperCode.includes(word)) {
        throw new Error('Coupon code contains inappropriate language');
      }
    }
  }

  /**
   * Validate coupon is active
   */
  validateCouponStatus(coupon) {
    if (coupon.status !== 'active') {
      throw new Error(`This coupon is ${coupon.status}`);
    }
  }

  /**
   * Validate coupon date range
   */
  validateDateRange(coupon) {
    const now = new Date();
    
    if (coupon.startsAt && new Date(coupon.startsAt) > now) {
      throw new Error('This coupon is not yet active');
    }
    
    if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
      throw new Error('This coupon has expired');
    }
  }

  /**
   * Validate usage limit
   */
  validateUsageLimit(coupon) {
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      throw new Error('This coupon has reached its usage limit');
    }
  }

  /**
   * Validate content type applicability
   */
  validateContentType(coupon, contentType) {
    if (!coupon.applicableContentTypes.includes(contentType)) {
      throw new Error(`This coupon is not applicable to ${contentType}`);
    }
  }

  /**
   * Validate specific content ID
   */
  validateContentId(coupon, contentId) {
    if (coupon.specificContentIds && coupon.specificContentIds.length > 0) {
      if (!coupon.specificContentIds.includes(contentId)) {
        throw new Error('This coupon is not applicable to this content');
      }
    }
  }

  /**
   * Validate creator ownership of content
   */
  async validateCreatorOwnership(creatorId, contentType, contentIds) {
    for (const contentId of contentIds) {
      let content;
      
      if (contentType === 'video') {
        content = await Video.findByPk(contentId, {
          attributes: ['userId']
        });
      } else if (contentType === 'live_class') {
        content = await LiveClass.findByPk(contentId, {
          attributes: ['userId']
        });
      } else if (contentType === 'live_series') {
        const { LiveSeries } = require('../models/liveSeriesIndex');
        content = await LiveSeries.findByPk(contentId, {
          attributes: ['userId']
        });
      }
      
      if (!content) {
        throw new Error(`Content ${contentId} not found`);
      }
      
      if (content.userId !== creatorId) {
        throw new Error(`You do not own content ${contentId}`);
      }
    }
  }
}

module.exports = CouponValidationService;
