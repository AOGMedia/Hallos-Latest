const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizTournamentAnswer Model
 *
 * Records individual answer submissions for shared-question-set tournament
 * formats (classic, speed_run, battle_royale) — mirrors QuizMatchAnswer,
 * scoped to a tournament round instead of a 1v1 match. Knockout format
 * doesn't use this; it reuses QuizMatchAnswer via real QuizMatch rows.
 */
const QuizTournamentAnswer = sequelize.define('QuizTournamentAnswer', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  roundId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'round_id',
    references: { model: 'quiz_tournament_rounds', key: 'id' }
  },
  tournamentId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'tournament_id',
    references: { model: 'quiz_tournaments', key: 'id' }
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
    references: { model: 'Users', key: 'id' }
  },
  questionId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'question_id',
    references: { model: 'quiz_questions', key: 'id' }
  },
  selectedAnswer: {
    type: DataTypes.STRING(7),
    allowNull: false,
    field: 'selected_answer',
    validate: { isIn: [['a', 'b', 'c', 'd', 'timeout']] }
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
    field: 'client_timestamp'
  },
  serverTimestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
    field: 'server_timestamp'
  },
  latency: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'quiz_tournament_answers',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true
});

QuizTournamentAnswer.associate = (models) => {
  QuizTournamentAnswer.belongsTo(models.QuizTournamentRound, { foreignKey: 'roundId', as: 'round' });
  QuizTournamentAnswer.belongsTo(models.QuizTournament, { foreignKey: 'tournamentId', as: 'tournament' });
  QuizTournamentAnswer.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  QuizTournamentAnswer.belongsTo(models.QuizQuestion, { foreignKey: 'questionId', as: 'question' });
};

module.exports = QuizTournamentAnswer;
