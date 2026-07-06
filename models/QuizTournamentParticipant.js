const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizTournamentParticipant Model
 * 
 * Tracks user participation in tournaments
 * Records registration, status, placement, and prizes
 */

const QuizTournamentParticipant = sequelize.define('QuizTournamentParticipant', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  tournamentId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'tournament_id',
    references: {
      model: 'quiz_tournaments',
      key: 'id'
    }
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
  entryFeePaid: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'entry_fee_paid',
    comment: 'Entry fee paid in Chuta'
  },
  currentRound: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'current_round'
  },
  status: {
    type: DataTypes.ENUM('registered', 'active', 'eliminated', 'winner'),
    allowNull: false,
    defaultValue: 'registered'
  },
  totalScore: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_score'
  },
  averageTime: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'average_time',
    comment: 'Average response time in seconds'
  },
  placement: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Final ranking position'
  },
  prizeWon: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'prize_won',
    comment: 'Prize amount in Chuta'
  },
  registeredAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'registered_at'
  },
  eliminatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'eliminated_at'
  }
}, {
  tableName: 'quiz_tournament_participants',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['tournament_id', 'user_id']
    },
    {
      fields: ['tournament_id', 'status']
    },
    {
      fields: ['user_id']
    }
  ]
});

/**
 * Associations
 */
QuizTournamentParticipant.associate = (models) => {
  QuizTournamentParticipant.belongsTo(models.QuizTournament, {
    foreignKey: 'tournamentId',
    as: 'tournament'
  });

  QuizTournamentParticipant.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user'
  });
};

module.exports = QuizTournamentParticipant;
