const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CouponUsage = sequelize.define('CouponUsage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  couponId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'coupon_id'
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  purchaseId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'purchase_id'
  },
  originalPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'original_price'
  },
  discountAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'discount_amount'
  },
  finalPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'final_price'
  },
  partnerCommissionAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'partner_commission_amount'
  },
  contentType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'content_type'
  },
  contentId: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'content_id'
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false
  }
}, {
  tableName: 'coupon_usage',
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = CouponUsage;
