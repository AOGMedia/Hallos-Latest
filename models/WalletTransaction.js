const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Wallet Transaction Model
 * 
 * Records all financial transactions for multi-currency wallet accounts.
 * Maps to the 'financial_transactions' table created by migration.
 * 
 * Transaction Types:
 * - credit: Money added to wallet (top-ups, refunds, earnings)
 * - debit: Money removed from wallet (withdrawals, purchases)
 * - transfer_in: Money transferred from another wallet
 * - transfer_out: Money transferred to another wallet
 */
const WalletTransaction = sequelize.define('WalletTransaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  wallet_account_id: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'wallet_id',
    references: {
      model: 'wallet_accounts',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  transaction_type: {
    type: DataTypes.ENUM('credit', 'debit', 'transfer_in', 'transfer_out'),
    allowNull: false
  },
  amount: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: 'Amount in smallest currency unit (kobo/cents)'
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false
  },
  reference: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending'
  },
  gateway: {
    type: DataTypes.ENUM('paystack', 'stripe'),
    allowNull: true
  },
  external_reference: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  idempotency_key: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'financial_transactions',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      fields: ['wallet_id']  // Use actual database column name
    },
    {
      fields: ['transaction_type']
    },
    {
      fields: ['currency']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    },
    {
      fields: ['idempotency_key']
    },
    {
      unique: true,
      fields: ['reference']
    }
  ]
});

/**
 * Get amount in major currency unit (dollars/naira)
 */
WalletTransaction.prototype.getAmountInMajorUnit = function() {
  return this.amount / 100;
};

/**
 * Check if transaction is completed
 */
WalletTransaction.prototype.isCompleted = function() {
  return this.status === 'completed';
};

/**
 * Check if transaction is pending
 */
WalletTransaction.prototype.isPending = function() {
  return this.status === 'pending';
};

/**
 * Check if transaction is a credit
 */
WalletTransaction.prototype.isCredit = function() {
  return this.transaction_type === 'credit' || this.transaction_type === 'transfer_in';
};

/**
 * Check if transaction is a debit
 */
WalletTransaction.prototype.isDebit = function() {
  return this.transaction_type === 'debit' || this.transaction_type === 'transfer_out';
};

module.exports = WalletTransaction;
