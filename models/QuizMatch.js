const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizMatch Model
 * 
 * Stores quiz match records for both lobby and tournament modes
 * Tracks participants, questions, scores, and match state
 */

const QuizMatch = sequelize.define('QuizMatch', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  matchType: {
    type: DataTypes.ENUM('lobby', 'tournament'),
    allowNull: false,
    field: 'match_type'
  },
  tournamentId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'tournament_id',
    references: {
      model: 'quiz_tournaments',
      key: 'id'
    }
  },
  participants: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'Array of { userId, wagerAmount, score, completionTime, answers, status }'
  },
  questions: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  questionStartTimes: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'question_start_times',
    comment: 'Map of questionId to timestamp'
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'completed', 'cancelled', 'expired'),
    allowNull: false,
    defaultValue: 'pending'
  },
  winnerId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'winner_id',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  escrowAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'escrow_amount',
    comment: 'Total escrowed Chuta'
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
  },
  challengerId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'challenger_id',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  opponentId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'opponent_id',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  counterOfferId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'counter_offer_id'
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'expires_at'
  },
  categoryId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'category_id',
    references: {
      model: 'quiz_categories',
      key: 'id'
    }
  }
}, {
  tableName: 'quiz_matches',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['status', 'created_at']
    },
    {
      fields: ['tournament_id']
    }
  ]
});

/**
 * Associations
 */
QuizMatch.associate = (models) => {
  QuizMatch.belongsTo(models.QuizTournament, {
    foreignKey: 'tournamentId',
    as: 'tournament'
  });

  QuizMatch.belongsTo(models.User, {
    foreignKey: 'winnerId',
    as: 'winner'
  });

  QuizMatch.hasMany(models.QuizMatchAnswer, {
    foreignKey: 'matchId',
    as: 'matchAnswers'
  });
};

module.exports = QuizMatch;
