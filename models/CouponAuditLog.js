const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CouponAuditLog = sequelize.define('CouponAuditLog', {
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
  actionType: {
    type: DataTypes.ENUM('create', 'update', 'delete', 'activate', 'deactivate'),
    allowNull: false,
    field: 'action_type'
  },
  oldValues: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'old_values'
  },
  newValues: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'new_values'
  }
}, {
  tableName: 'coupon_audit_log',
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = CouponAuditLog;
