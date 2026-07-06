const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Withdrawal OTP Model
 * 
 * Stores OTP codes for withdrawal 2FA verification
 * Replaces in-memory storage to survive server restarts
 */
const WithdrawalOTP = sequelize.define('WithdrawalOTP', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  withdrawalId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Unique withdrawal identifier'
  },
  
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'User who initiated the withdrawal'
  },
  
  code: {
    type: DataTypes.STRING(6),
    allowNull: false,
    comment: '6-digit OTP code'
  },
  
  amount: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    comment: 'Withdrawal amount'
  },
  
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    comment: 'Currency code (NGN, USD)'
  },
  
  bankAccount: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: 'Bank account details for withdrawal'
  },
  
  reference: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Withdrawal reference'
  },
  
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of verification attempts'
  },
  
  maxAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
    comment: 'Maximum allowed attempts'
  },
  
  status: {
    type: DataTypes.ENUM('pending', 'verified', 'expired', 'failed'),
    defaultValue: 'pending',
    comment: 'OTP status'
  },
  
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'OTP expiration time'
  },
  
  verifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When OTP was successfully verified'
  },
  
  lastResendAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last time OTP was resent'
  }
}, {
  tableName: 'withdrawal_otps',
  timestamps: true,
  indexes: [
    {
      fields: ['withdrawalId'],
      unique: true
    },
    {
      fields: ['userId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['expiresAt']
    }
  ]
});

module.exports = WithdrawalOTP;