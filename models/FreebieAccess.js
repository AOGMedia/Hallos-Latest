const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FreebieAccess = sequelize.define('FreebieAccess', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  freebieId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'freebie_id'
  },
  purchaseReference: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'purchase_reference'
  },
  amountPaid: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'amount_paid'
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false
  },
  couponId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'coupon_id'
  }
}, {
  tableName: 'freebie_access',
  timestamps: true,
  underscored: true,
  updatedAt: false,
  indexes: [{ unique: true, fields: ['user_id', 'freebie_id'] }]
});

module.exports = FreebieAccess;
