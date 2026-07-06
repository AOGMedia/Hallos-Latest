const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CampaignQuizSession = sequelize.define('CampaignQuizSession', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  registrationId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true, // one session per registration
    field: 'registration_id',
    references: { model: 'campaign_registrations', key: 'id' }
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true, // set when user logs in and starts the quiz
    field: 'user_id',
    references: { model: 'Users', key: 'id' }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  accessToken: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    field: 'access_token'
  },
  tokenExpiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'token_expires_at'
  },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'pending',
    // pending → active → completed | expired
  },
  categoryId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'category_id'
  },
  // Ordered array of 20 question UUIDs assigned to this session
  questions: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  // { questionId: { shuffledOptions: { a: "text", ... }, correctAnswer: "c" } }
  // correctAnswer here is the key AFTER shuffling — never sent to client
  sessionData: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    field: 'session_data'
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  totalCorrect: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
    field: 'total_correct'
  },
  // Total time from startedAt to completedAt in milliseconds — tiebreaker
  totalTimeMs: {
    type: DataTypes.BIGINT,
    allowNull: true,
    defaultValue: null,
    field: 'total_time_ms'
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
  resultEmailSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'result_email_sent'
  }
}, {
  tableName: 'campaign_quiz_sessions',
  timestamps: true,
  underscored: true
});

module.exports = CampaignQuizSession;
