const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizTournamentRound Model
 * 
 * Tracks individual rounds within a tournament
 * Stores questions, participant scores, and elimination data
 */

const QuizTournamentRound = sequelize.define('QuizTournamentRound', {
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
  roundNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'round_number'
  },
  questions: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'Array of question IDs for this round'
  },
  participants: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'Array of { userId, score, completionTime, rank }'
  },
  eliminatedUsers: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'eliminated_users',
    comment: 'Array of user IDs eliminated in this round'
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'completed'),
    allowNull: false,
    defaultValue: 'pending'
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'started_at'
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'completed_at'
  }
}, {
  tableName: 'quiz_tournament_rounds',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['tournament_id', 'round_number']
    },
    {
      fields: ['tournament_id']
    }
  ]
});

/**
 * Associations
 */
QuizTournamentRound.associate = (models) => {
  QuizTournamentRound.belongsTo(models.QuizTournament, {
    foreignKey: 'tournamentId',
    as: 'tournament'
  });
};

module.exports = QuizTournamentRound;
