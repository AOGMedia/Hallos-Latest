const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Multi-Currency Wallet Account Model
 * 
 * Represents individual currency accounts within a user's multi-currency wallet.
 * Each user can have multiple wallet accounts (one per supported currency).
 */
const WalletAccount = sequelize.define('WalletAccount', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    validate: {
      isIn: [['NGN', 'USD']]
    }
  },
  balance_available: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0,
    comment: 'Available balance in smallest currency unit (kobo/cents)'
  },
  balance_pending: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0,
    comment: 'Pending withdrawals in smallest currency unit'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'wallet_accounts',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'currency'],
      name: 'wallet_accounts_user_currency_unique'
    },
    {
      fields: ['currency']
    }
  ]
});

/**
 * Get balance in major currency unit (dollars/naira)
 */
WalletAccount.prototype.getAvailableBalanceInMajorUnit = function() {
  return this.balance_available / 100;
};

/**
 * Get pending balance in major currency unit
 */
WalletAccount.prototype.getPendingBalanceInMajorUnit = function() {
  return this.balance_pending / 100;
};

/**
 * Get total balance (available + pending) in major currency unit
 */
WalletAccount.prototype.getTotalBalanceInMajorUnit = function() {
  return (this.balance_available + this.balance_pending) / 100;
};

/**
 * Check if account has sufficient balance for withdrawal
 */
WalletAccount.prototype.hasSufficientBalance = function(amountInMajorUnit) {
  const amountInMinorUnit = Math.round(amountInMajorUnit * 100);
  return this.balance_available >= amountInMinorUnit;
};

module.exports = WalletAccount;