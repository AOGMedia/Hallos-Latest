const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * ChutaCoinTransaction Model
 * 
 * Records all Chuta coin transactions for audit trail
 * Tracks deposits, withdrawals, wagers, prizes, and refunds
 */

const ChutaCoinTransaction = sequelize.define('ChutaCoinTransaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM(
      'initial_bonus',
      'purchase',
      'withdrawal',
      'match_wager',
      'match_win',
      'match_refund',
      'tournament_entry',
      'tournament_prize',
      'tournament_refund',
      'admin_adjustment'
    ),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Amount in Chuta (positive for credit, negative for debit)'
  },
  balanceAfter: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'balance_after',
    comment: 'User balance after this transaction'
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Additional transaction details (matchId, tournamentId, usdAmount, etc.)'
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed', 'reversed'),
    allowNull: false,
    defaultValue: 'completed'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'chuta_coin_transactions',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id', 'created_at']
    },
    {
      fields: ['type', 'created_at']
    },
    {
      fields: ['status']
    },
    {
      fields: ['user_id', 'type']
    }
  ]
});

/**
 * Associations
 */
ChutaCoinTransaction.associate = (models) => {
  ChutaCoinTransaction.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user'
  });
};

module.exports = ChutaCoinTransaction;
