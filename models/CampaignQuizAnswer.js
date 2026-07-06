const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Immutable answer record — never updated after creation
const CampaignQuizAnswer = sequelize.define('CampaignQuizAnswer', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  sessionId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'session_id',
    references: { model: 'campaign_quiz_sessions', key: 'id' }
  },
  questionId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'question_id',
    references: { model: 'quiz_questions', key: 'id' }
  },
  questionIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'question_index' // 0-19
  },
  selectedAnswer: {
    type: DataTypes.STRING(7),
    allowNull: false,
    field: 'selected_answer' // a/b/c/d/e or 'timeout'
  },
  isCorrect: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    field: 'is_correct'
  },
  // Time in ms from question window start to answer submission (max 15000)
  responseTimeMs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'response_time_ms'
  },
  clientTimestamp: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'client_timestamp'
  },
  serverTimestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
    field: 'server_timestamp'
  }
}, {
  tableName: 'campaign_quiz_answers',
  timestamps: true,
  underscored: true,
  updatedAt: false // immutable
});

module.exports = CampaignQuizAnswer;
