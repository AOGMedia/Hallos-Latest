const Coupon = require('../models/Coupon');
const CouponUsage = require('../models/CouponUsage');
const sequelize = require('../config/db');
const { Op } = require('sequelize');

class CouponAnalyticsService {
  /**
   * Get coupon statistics (total redemptions, revenue, discounts, partner commissions)
   */
  async getCouponStatistics(couponId) {
    try {
      const coupon = await Coupon.findByPk(couponId);
      
      if (!coupon) {
        throw new Error('Coupon not found');
      }
      
      const usages = await CouponUsage.findAll({
        where: { couponId },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'totalRedemptions'],
          [sequelize.fn('SUM', sequelize.col('original_price')), 'totalOriginalRevenue'],
          [sequelize.fn('SUM', sequelize.col('final_price')), 'totalFinalRevenue'],
          [sequelize.fn('SUM', sequelize.col('discount_amount')), 'totalDiscounts'],
          [sequelize.fn('SUM', sequelize.col('partner_commission_amount')), 'totalPartnerCommissions']
        ],
        raw: true
      });
      
      const stats = usages[0];
      
      return {
        couponId: coupon.id,
        code: coupon.code,
        type: coupon.type,
        status: coupon.status,
        totalRedemptions: parseInt(stats.totalRedemptions) || 0,
        totalOriginalRevenue: parseFloat(stats.totalOriginalRevenue) || 0,
        totalFinalRevenue: parseFloat(stats.totalFinalRevenue) || 0,
        totalDiscounts: parseFloat(stats.totalDiscounts) || 0,
        totalPartnerCommissions: parseFloat(stats.totalPartnerCommissions) || 0,
        usageLimit: coupon.usageLimit,
        usageCount: coupon.usageCount
      };
      
    } catch (error) {
      console.error('[CouponAnalyticsService] Get statistics error:', error);
      throw error;
    }
  }

  /**
   * Get top performing coupons ranked by redemptions
   */
  async getTopPerformingCoupons(limit = 10, filters = {}) {
    try {
      const where = {};
      
      // Apply filters
      if (filters.type) {
        where.type = filters.type;
      }
      
      if (filters.status) {
        where.status = filters.status;
      }
      
      if (filters.creatorId) {
        where.creatorId = filters.creatorId;
      }
      
      const coupons = await Coupon.findAll({
        where,
        include: [
          {
            model: CouponUsage,
            as: 'usageRecords',
            attributes: []
          }
        ],
        attributes: [
          'id',
          'code',
          'type',
          'status',
          'discountType',
          'discountValue',
          'usageCount',
          [sequelize.fn('COUNT', sequelize.col('usageRecords.id')), 'totalRedemptions'],
          [sequelize.fn('SUM', sequelize.col('usageRecords.discount_amount')), 'totalDiscounts'],
          [sequelize.fn('SUM', sequelize.col('usageRecords.final_price')), 'totalRevenue']
        ],
        group: ['Coupon.id'],
        order: [[sequelize.literal('"totalRedemptions"'), 'DESC']],
        limit,
        subQuery: false
      });
      
      return coupons.map(coupon => ({
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        status: coupon.status,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        usageCount: coupon.usageCount,
        totalRedemptions: parseInt(coupon.dataValues.totalRedemptions) || 0,
        totalDiscounts: parseFloat(coupon.dataValues.totalDiscounts) || 0,
        totalRevenue: parseFloat(coupon.dataValues.totalRevenue) || 0
      }));
      
    } catch (error) {
      console.error('[CouponAnalyticsService] Get top performing coupons error:', error);
      throw error;
    }
  }

  /**
   * Get coupon usage history with pagination
   */
  async getCouponUsageHistory(couponId, options = {}) {
    try {
      const { page = 1, limit = 50 } = options;
      const offset = (page - 1) * limit;
      
      const { count, rows } = await CouponUsage.findAndCountAll({
        where: { couponId },
        order: [['created_at', 'DESC']],
        limit,
        offset,
        attributes: [
          'id',
          'userId',
          'purchaseId',
          'originalPrice',
          'discountAmount',
          'finalPrice',
          'partnerCommissionAmount',
          'contentType',
          'contentId',
          'currency'
        ]
      });
      
      return {
        usages: rows,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit)
        }
      };
      
    } catch (error) {
      console.error('[CouponAnalyticsService] Get usage history error:', error);
      throw error;
    }
  }

  /**
   * Get aggregate analytics with currency and content type grouping
   */
  async getAggregateAnalytics(filters = {}) {
    try {
      const where = {};
      
      // Apply date range filter
      if (filters.startDate || filters.endDate) {
        where.created_at = {};
        if (filters.startDate) {
          where.created_at[Op.gte] = new Date(filters.startDate);
        }
        if (filters.endDate) {
          where.created_at[Op.lte] = new Date(filters.endDate);
        }
      }
      
      // Apply content type filter
      if (filters.contentType) {
        where.contentType = filters.contentType;
      }
      
      // Apply currency filter
      if (filters.currency) {
        where.currency = filters.currency;
      }
      
      const aggregates = await CouponUsage.findAll({
        where,
        attributes: [
          'currency',
          'contentType',
          [sequelize.fn('COUNT', sequelize.col('id')), 'totalRedemptions'],
          [sequelize.fn('SUM', sequelize.col('original_price')), 'totalOriginalRevenue'],
          [sequelize.fn('SUM', sequelize.col('final_price')), 'totalFinalRevenue'],
          [sequelize.fn('SUM', sequelize.col('discount_amount')), 'totalDiscounts'],
          [sequelize.fn('SUM', sequelize.col('partner_commission_amount')), 'totalPartnerCommissions']
        ],
        group: ['currency', 'contentType'],
        raw: true
      });
      
      return aggregates.map(agg => ({
        currency: agg.currency,
        contentType: agg.contentType,
        totalRedemptions: parseInt(agg.totalRedemptions) || 0,
        totalOriginalRevenue: parseFloat(agg.totalOriginalRevenue) || 0,
        totalFinalRevenue: parseFloat(agg.totalFinalRevenue) || 0,
        totalDiscounts: parseFloat(agg.totalDiscounts) || 0,
        totalPartnerCommissions: parseFloat(agg.totalPartnerCommissions) || 0
      }));
      
    } catch (error) {
      console.error('[CouponAnalyticsService] Get aggregate analytics error:', error);
      throw error;
    }
  }
}

module.exports = CouponAnalyticsService;
