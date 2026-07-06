/**
 * Quiz Models Index
 * 
 * Sets up associations between Quiz models
 */

const QuizCategory = require('./QuizCategory');
const QuizQuestion = require('./QuizQuestion');
const QuizMatch = require('./QuizMatch');
const QuizTournament = require('./QuizTournament');
const QuizTournamentParticipant = require('./QuizTournamentParticipant');
const QuizTournamentRound = require('./QuizTournamentRound');
const QuizMatchAnswer = require('./QuizMatchAnswer');
const ChutaCoinTransaction = require('./ChutaCoinTransaction');
const UserQuizStats = require('./UserQuizStats');
const User = require('./User');

// QuizCategory associations
QuizCategory.hasMany(QuizQuestion, {
  foreignKey: 'categoryId',
  as: 'questions'
});

QuizCategory.hasMany(QuizTournament, {
  foreignKey: 'categoryId',
  as: 'tournaments'
});

// QuizQuestion associations
QuizQuestion.belongsTo(QuizCategory, {
  foreignKey: 'categoryId',
  as: 'category'
});

QuizQuestion.belongsTo(User, {
  foreignKey: 'createdBy',
  as: 'creator'
});

QuizQuestion.hasMany(QuizMatchAnswer, {
  foreignKey: 'questionId',
  as: 'answers'
});

// QuizMatch associations
QuizMatch.belongsTo(QuizTournament, {
  foreignKey: 'tournamentId',
  as: 'tournament'
});

QuizMatch.hasMany(QuizMatchAnswer, {
  foreignKey: 'matchId',
  as: 'answers'
});

// QuizTournament associations
QuizTournament.belongsTo(QuizCategory, {
  foreignKey: 'categoryId',
  as: 'category'
});

QuizTournament.belongsTo(User, {
  foreignKey: 'createdBy',
  as: 'creator'
});

QuizTournament.belongsTo(User, {
  foreignKey: 'proposedBy',
  as: 'proposer'
});

QuizTournament.hasMany(QuizTournamentParticipant, {
  foreignKey: 'tournamentId',
  as: 'participants'
});

QuizTournament.hasMany(QuizTournamentRound, {
  foreignKey: 'tournamentId',
  as: 'rounds'
});

QuizTournament.hasMany(QuizMatch, {
  foreignKey: 'tournamentId',
  as: 'matches'
});

// QuizTournamentParticipant associations
QuizTournamentParticipant.belongsTo(QuizTournament, {
  foreignKey: 'tournamentId',
  as: 'tournament'
});

QuizTournamentParticipant.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// QuizTournamentRound associations
QuizTournamentRound.belongsTo(QuizTournament, {
  foreignKey: 'tournamentId',
  as: 'tournament'
});

// QuizMatchAnswer associations
QuizMatchAnswer.belongsTo(QuizMatch, {
  foreignKey: 'matchId',
  as: 'match'
});

QuizMatchAnswer.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

QuizMatchAnswer.belongsTo(QuizQuestion, {
  foreignKey: 'questionId',
  as: 'question'
});

// ChutaCoinTransaction associations
ChutaCoinTransaction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// UserQuizStats associations
UserQuizStats.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// User associations (reverse relationships)
User.hasMany(QuizQuestion, {
  foreignKey: 'createdBy',
  as: 'createdQuestions'
});

User.hasMany(QuizTournament, {
  foreignKey: 'createdBy',
  as: 'createdTournaments'
});

User.hasMany(QuizTournament, {
  foreignKey: 'proposedBy',
  as: 'proposedTournaments'
});

User.hasMany(QuizTournamentParticipant, {
  foreignKey: 'userId',
  as: 'tournamentParticipations'
});

User.hasMany(QuizMatchAnswer, {
  foreignKey: 'userId',
  as: 'quizAnswers'
});

User.hasMany(ChutaCoinTransaction, {
  foreignKey: 'userId',
  as: 'chutaTransactions'
});

User.hasOne(UserQuizStats, {
  foreignKey: 'userId',
  as: 'quizStats'
});

module.exports = {
  QuizCategory,
  QuizQuestion,
  QuizMatch,
  QuizTournament,
  QuizTournamentParticipant,
  QuizTournamentRound,
  QuizMatchAnswer,
  ChutaCoinTransaction,
  UserQuizStats
};
