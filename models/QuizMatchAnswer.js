const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizMatchAnswer Model
 * 
 * Records individual answer submissions during matches
 * Tracks correctness, timing, and latency for anti-cheat validation
 */

const QuizMatchAnswer = sequelize.define('QuizMatchAnswer', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  matchId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'match_id',
    references: {
      model: 'quiz_matches',
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
  questionId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'question_id',
    references: {
      model: 'quiz_questions',
      key: 'id'
    }
  },
  selectedAnswer: {
    type: DataTypes.STRING(7),
    allowNull: false,
    field: 'selected_answer',
    validate: {
      isIn: [['a', 'b', 'c', 'd', 'timeout']]
    }
  },
  isCorrect: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    field: 'is_correct'
  },
  responseTime: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false,
    field: 'response_time',
    comment: 'Response time in seconds'
  },
  clientTimestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
    field: 'client_timestamp',
    comment: 'Unix timestamp in ms from client when answer was submitted'
  },
  serverTimestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
    field: 'server_timestamp',
    comment: 'Unix timestamp in ms when server received the answer'
  },
  latency: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Calculated latency in milliseconds'
  }
}, {
  tableName: 'quiz_match_answers',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    {
      fields: ['match_id', 'user_id']
    },
    {
      fields: ['user_id', 'created_at']
    },
    {
      fields: ['match_id']
    }
  ]
});

/**
 * Associations
 */
QuizMatchAnswer.associate = (models) => {
  QuizMatchAnswer.belongsTo(models.QuizMatch, {
    foreignKey: 'matchId',
    as: 'match'
  });

  QuizMatchAnswer.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user'
  });

  QuizMatchAnswer.belongsTo(models.QuizQuestion, {
    foreignKey: 'questionId',
    as: 'question'
  });
};

module.exports = QuizMatchAnswer;
