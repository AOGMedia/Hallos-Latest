const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Payout = sequelize.define('Payout', {
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
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  platformFee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'platform_fee'
  },
  gatewayFee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'gateway_fee'
  },
  netAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'net_amount'
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'NGN'
  },
  paymentGateway: {
    type: DataTypes.ENUM('paystack', 'stripe'),
    allowNull: false,
    field: 'payment_gateway'
  },
  bankName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'bank_name'
  },
  accountNumber: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'account_number'
  },
  accountName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'account_name'
  },
  transferReference: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: true,
    field: 'transfer_reference'
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    defaultValue: 'pending'
  },
  failureReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'failure_reason'
  }
}, {
  tableName: 'payouts',
  timestamps: true,
  underscored: true
});

module.exports = Payout;
