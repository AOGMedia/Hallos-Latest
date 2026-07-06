const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Wallet = sequelize.define('Wallet', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    unique: true,
    allowNull: false,
    field: 'user_id'
  },
  totalEarnings: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    field: 'total_earnings'
  },
  withdrawnAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    field: 'withdrawn_amount'
  },
  pendingAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    field: 'pending_amount'
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'NGN'
  }
}, {
  tableName: 'wallets',
  timestamps: true,
  underscored: true
});

// Virtual field for available balance
Wallet.prototype.getAvailableBalance = function() {
  return parseFloat(this.totalEarnings) - parseFloat(this.withdrawnAmount) - parseFloat(this.pendingAmount);
};

module.exports = Wallet;
