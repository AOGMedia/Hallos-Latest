const Coupon = require('../models/Coupon');
const CouponUsage = require('../models/CouponUsage');
const CouponAuditLog = require('../models/CouponAuditLog');
const CouponValidationService = require('./couponValidationService');
const sequelize = require('../config/db');
const { Op } = require('sequelize');

class CouponService {
  constructor() {
    this.validationService = new CouponValidationService();
  }

  /**
   * Create a new coupon
   */
  async createCoupon(couponData, creatorUserId, isAdmin = false) {
    const transaction = await sequelize.transaction();
    
    try {
      // Validate code format
      this.validationService.validateCodeFormat(couponData.code);
      
      // Check for duplicate code (case-insensitive)
      const existingCoupon = await Coupon.findOne({
        where: sequelize.where(
          sequelize.fn('UPPER', sequelize.col('code')),
          couponData.code.toUpperCase()
        )
      });
      
      if (existingCoupon) {
        throw new Error(`Coupon code '${couponData.code}' already exists`);
      }
      
      // Validate creator ownership if specific content IDs provided (skip for admins)
      if (!isAdmin && couponData.specificContentIds && couponData.specificContentIds.length > 0) {
        for (const contentType of couponData.applicableContentTypes) {
          await this.validationService.validateCreatorOwnership(
            couponData.creatorId || creatorUserId,
            contentType,
            couponData.specificContentIds
          );
        }
      }
      
      // Set creator ID if not admin creating partner coupon
      if (couponData.type === 'creator' && !couponData.creatorId) {
        couponData.creatorId = creatorUserId;
      }
      
      // Validate partner coupon requirements
      if (couponData.type === 'partner') {
        if (!isAdmin) {
          throw new Error('Only administrators can create partner coupons');
        }
        if (!couponData.partnerUserId || !couponData.partnerCommissionPercent) {
          throw new Error('Partner coupons require partner_user_id and partner_commission_percent');
        }
      }
      
      // Create coupon
      const coupon = await Coupon.create(couponData, { transaction });
      
      // Create audit log
      await CouponAuditLog.create({
        couponId: coupon.id,
        userId: creatorUserId,
        actionType: 'create',
        newValues: coupon.toJSON()
      }, { transaction });
      
      await transaction.commit();
      
      console.log(`[CouponService] Created coupon: ${coupon.code} (${coupon.type})`);
      return coupon;
      
    } catch (error) {
      await transaction.rollback();
      console.error('[CouponService] Create coupon error:', error);
      throw error;
    }
  }

  /**
   * Validate coupon for a specific purchase
   */
  async validateCoupon(code, contentType, contentId, userId, targetCurrency = null) {
    try {
      // Normalize code
      const normalizedCode = code.trim().toUpperCase();
      
      // Get coupon
      const coupon = await this.getCouponByCode(normalizedCode);
      
      if (!coupon) {
        return {
          valid: false,
          error: 'Invalid coupon code'
        };
      }
      
      // Validate all rules
      try {
        this.validationService.validateCouponStatus(coupon);
        this.validationService.validateDateRange(coupon);
        this.validationService.validateUsageLimit(coupon);
        this.validationService.validateContentType(coupon, contentType);
        this.validationService.validateContentId(coupon, contentId);
      } catch (validationError) {
        return {
          valid: false,
          error: validationError.message
        };
      }
      
      // Get content price
      const contentPrice = await this.getContentPrice(contentType, contentId);
      
      if (!contentPrice) {
        return {
          valid: false,
          error: 'Content not found'
        };
      }
      
      // Calculate discount in the target currency (what the student is actually paying in)
      // If targetCurrency differs from content's base currency, convert first
      const CurrencyConversionService = require('./currencyConversionService');
      const conversionService = new CurrencyConversionService();
      
      const effectiveCurrency = targetCurrency || contentPrice.currency;
      let priceForCalculation = contentPrice.price;
      
      if (effectiveCurrency !== contentPrice.currency) {
        priceForCalculation = conversionService.convert(
          contentPrice.price,
          contentPrice.currency,
          effectiveCurrency
        );
      }
      
      // Calculate discount
      const discountResult = this.calculateDiscount(coupon, priceForCalculation);
      
      return {
        valid: true,
        coupon: {
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          partnerUserId: coupon.partnerUserId || null
        },
        originalPrice: priceForCalculation,
        currency: effectiveCurrency,
        discountAmount: discountResult.discountAmount,
        finalPrice: discountResult.finalPrice,
        partnerCommission: discountResult.partnerCommission
      };
      
    } catch (error) {
      console.error('[CouponService] Validate coupon error:', error);
      throw error;
    }
  }

  /**
   * Calculate discount amount based on coupon configuration
   */
  calculateDiscount(coupon, originalPrice) {
    let discountAmount = 0;
    let partnerCommission = null;
    
    if (coupon.type === 'partner') {
      // Partner coupon: use discountValue for student discount, partnerCommissionPercent for commission
      discountAmount = (originalPrice * coupon.discountValue) / 100;
      partnerCommission = (originalPrice * coupon.partnerCommissionPercent) / 100;
      
    } else if (coupon.type === 'creator') {
      // Creator coupon: flexible discount
      if (coupon.discountType === 'percentage') {
        discountAmount = (originalPrice * coupon.discountValue) / 100;
      } else if (coupon.discountType === 'flat') {
        discountAmount = coupon.discountValue;
      }
    }
    
    // Ensure discount doesn't exceed original price
    if (discountAmount > originalPrice) {
      discountAmount = originalPrice;
    }
    
    // Round to 2 decimal places
    discountAmount = Math.round(discountAmount * 100) / 100;
    if (partnerCommission) {
      partnerCommission = Math.round(partnerCommission * 100) / 100;
    }
    
    const finalPrice = Math.max(0, originalPrice - discountAmount);
    
    return {
      discountAmount,
      finalPrice: Math.round(finalPrice * 100) / 100,
      partnerCommission
    };
  }

  /**
   * Record coupon usage after successful payment
   */
  async recordCouponUsage(usageData, externalTransaction = null) {
    const transaction = externalTransaction || await sequelize.transaction();
    const isOwnTransaction = !externalTransaction;
    
    try {
      const { couponId, userId, purchaseId, originalPrice, discountAmount, 
              finalPrice, partnerCommissionAmount, contentType, contentId, currency } = usageData;
      
      // Increment usage count
      await Coupon.increment('usageCount', {
        by: 1,
        where: { id: couponId },
        transaction
      });
      
      // Check if usage limit reached
      const coupon = await Coupon.findByPk(couponId, { transaction });
      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        await coupon.update({ status: 'inactive' }, { transaction });
        console.log(`[CouponService] Coupon ${coupon.code} reached usage limit and was deactivated`);
      }
      
      // Create usage record
      const usageRecord = await CouponUsage.create({
        couponId,
        userId,
        purchaseId,
        originalPrice,
        discountAmount,
        finalPrice,
        partnerCommissionAmount,
        contentType,
        contentId,
        currency
      }, { transaction });
      
      if (isOwnTransaction) await transaction.commit();
      
      console.log(`[CouponService] Recorded coupon usage: ${coupon.code} by user ${userId}`);
      return usageRecord;
      
    } catch (error) {
      if (isOwnTransaction) await transaction.rollback();
      console.error('[CouponService] Record usage error:', error);
      throw error;
    }
  }

  /**
   * Get coupon by code (case-insensitive)
   */
  async getCouponByCode(code) {
    return await Coupon.findOne({
      where: sequelize.where(
        sequelize.fn('UPPER', sequelize.col('code')),
        code.toUpperCase()
      )
    });
  }

  /**
   * Get content price and currency
   */
  async getContentPrice(contentType, contentId) {
    try {
      let content;
      
      if (contentType === 'video') {
        const Video = require('../models/Video');
        content = await Video.findByPk(contentId, {
          attributes: ['price', 'currency']
        });
      } else if (contentType === 'live_class') {
        const LiveClass = require('../models/liveClass');
        content = await LiveClass.findByPk(contentId, {
          attributes: ['price', 'currency']
        });
      } else if (contentType === 'live_series') {
        const { LiveSeries } = require('../models/liveSeriesIndex');
        content = await LiveSeries.findByPk(contentId, {
          attributes: ['price', 'currency']
        });
      } else if (contentType === 'freebie') {
        const Freebie = require('../models/Freebie');
        content = await Freebie.findByPk(contentId, {
          attributes: ['price', 'currency']
        });
      }
      
      if (!content) {
        return null;
      }
      
      return {
        price: parseFloat(content.price),
        currency: content.currency || 'NGN'
      };
      
    } catch (error) {
      console.error('[CouponService] Get content price error:', error);
      return null;
    }
  }

  /**
   * Update coupon with authorization and audit logging
   */
  async updateCoupon(couponId, updates, userId, isAdmin = false) {
    const transaction = await sequelize.transaction();
    
    try {
      const coupon = await Coupon.findByPk(couponId, { transaction });
      
      if (!coupon) {
        throw new Error('Coupon not found');
      }
      
      // Authorization check
      if (!isAdmin && coupon.type === 'creator' && coupon.creatorId !== userId) {
        throw new Error('Unauthorized: You can only update your own coupons');
      }
      
      if (!isAdmin && coupon.type === 'partner') {
        throw new Error('Unauthorized: Only administrators can update partner coupons');
      }
      
      // Prevent updating restricted fields
      const restrictedFields = ['id', 'code', 'type', 'partnerUserId', 'partnerCommissionPercent', 'creatorId', 'usageCount'];
      const allowedUpdates = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (!restrictedFields.includes(key)) {
          allowedUpdates[key] = value;
        }
      }
      
      // Store old values for audit
      const oldValues = coupon.toJSON();
      
      // Update coupon
      await coupon.update(allowedUpdates, { transaction });
      
      // Create audit log
      await CouponAuditLog.create({
        couponId: coupon.id,
        userId,
        actionType: 'update',
        oldValues,
        newValues: coupon.toJSON()
      }, { transaction });
      
      await transaction.commit();
      
      console.log(`[CouponService] Updated coupon: ${coupon.code} by user ${userId}`);
      return coupon;
      
    } catch (error) {
      await transaction.rollback();
      console.error('[CouponService] Update coupon error:', error);
      throw error;
    }
  }

  /**
   * Deactivate coupon (soft delete) with authorization
   */
  async deactivateCoupon(couponId, userId, isAdmin = false) {
    const transaction = await sequelize.transaction();
    
    try {
      const coupon = await Coupon.findByPk(couponId, { transaction });
      
      if (!coupon) {
        throw new Error('Coupon not found');
      }
      
      // Authorization check
      if (!isAdmin && coupon.type === 'creator' && coupon.creatorId !== userId) {
        throw new Error('Unauthorized: You can only deactivate your own coupons');
      }
      
      if (!isAdmin && coupon.type === 'partner') {
        throw new Error('Unauthorized: Only administrators can deactivate partner coupons');
      }
      
      // Store old values for audit
      const oldValues = coupon.toJSON();
      
      // Soft delete
      await coupon.update({ status: 'inactive' }, { transaction });
      
      // Create audit log
      await CouponAuditLog.create({
        couponId: coupon.id,
        userId,
        actionType: 'deactivate',
        oldValues,
        newValues: coupon.toJSON()
      }, { transaction });
      
      await transaction.commit();
      
      console.log(`[CouponService] Deactivated coupon: ${coupon.code} by user ${userId}`);
      return coupon;
      
    } catch (error) {
      await transaction.rollback();
      console.error('[CouponService] Deactivate coupon error:', error);
      throw error;
    }
  }

  /**
   * Get creator's coupons with filtering
   */
  async getCreatorCoupons(creatorId, filters = {}) {
    try {
      const where = {
        creatorId,
        type: 'creator'
      };
      
      // Apply filters
      if (filters.status) {
        where.status = filters.status;
      }
      
      if (filters.contentType) {
        where.applicableContentTypes = {
          [Op.contains]: [filters.contentType]
        };
      }
      
      const coupons = await Coupon.findAll({
        where,
        order: [['createdAt', 'DESC']],
        include: [
          {
            model: CouponUsage,
            as: 'usageRecords',
            attributes: []
          }
        ],
        attributes: {
          include: [
            [sequelize.fn('COUNT', sequelize.col('usageRecords.id')), 'totalUsages']
          ]
        },
        group: ['Coupon.id']
      });
      
      return coupons;
      
    } catch (error) {
      console.error('[CouponService] Get creator coupons error:', error);
      throw error;
    }
  }

  /**
   * Get all coupons (admin only) with filtering
   */
  async getAllCoupons(filters = {}) {
    try {
      const where = {};
      
      // Apply filters
      if (filters.status) {
        where.status = filters.status;
      }
      
      if (filters.type) {
        where.type = filters.type;
      }
      
      if (filters.contentType) {
        where.applicableContentTypes = {
          [Op.contains]: [filters.contentType]
        };
      }
      
      if (filters.creatorId) {
        where.creatorId = filters.creatorId;
      }
      
      const coupons = await Coupon.findAll({
        where,
        order: [['createdAt', 'DESC']],
        include: [
          {
            model: CouponUsage,
            as: 'usageRecords',
            attributes: []
          }
        ],
        attributes: {
          include: [
            [sequelize.fn('COUNT', sequelize.col('usageRecords.id')), 'totalUsages']
          ]
        },
        group: ['Coupon.id']
      });
      
      return coupons;
      
    } catch (error) {
      console.error('[CouponService] Get all coupons error:', error);
      throw error;
    }
  }
}

module.exports = CouponService;
