const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Transaction = sequelize.define('Transaction', {
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
  transactionType: {
    type: DataTypes.ENUM('purchase', 'payout', 'fee'),
    allowNull: false,
    field: 'transaction_type'
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'NGN'
  },
  referenceType: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'reference_type'
  },
  referenceId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'reference_id'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  }
}, {
  tableName: 'transactions',
  timestamps: true,
  underscored: true,
  updatedAt: false // Transactions are immutable, no updatedAt
});

module.exports = Transaction;
