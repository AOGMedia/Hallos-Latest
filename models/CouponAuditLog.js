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
  // NB: do not add `createdAt: 'created_at'` here — combined with
  // `underscored: true` it renames the *attribute* to `created_at`, breaking
  // any `order: [['createdAt', ...]]` query (see QuizTournamentAnswer.js /
  // ChatMessage.js, which hit and document this exact bug). `underscored:
  // true` alone already maps the `createdAt` attribute to the right column.
  timestamps: true,
  underscored: true,
  updatedAt: false
});

module.exports = CouponAuditLog;
