const express = require('express');
const router = express.Router();
const multer = require('multer');
const quizUserController = require('../controllers/quizUserController');
const quizCurrencyController = require('../controllers/quizCurrencyController');
const quizLobbyController = require('../controllers/quizLobbyController');
const quizTournamentController = require('../controllers/quizTournamentController');
const quizAdminController = require('../controllers/quizAdminController');
const quizLeaderboardController = require('../controllers/quizLeaderboardController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const quizErrorHandler = require('../middleware/quizErrorHandler');
const quizRateLimiter = require('../middleware/quizRateLimiter');
const quizInputSanitizer = require('../middleware/quizInputSanitizer');

// Configure multer for file uploads (Excel files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('[multer fileFilter] fieldname:', file.fieldname, '| mimetype:', file.mimetype, '| originalname:', file.originalname);
    const allowedMimes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'application/csv',
      'application/octet-stream' // some clients send CSV/Excel as this
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only Excel (.xlsx, .xls) and CSV files are allowed.`));
    }
  }
});

/**
 * Quiz Platform Routes
 * 
 * User Routes:
 * - POST /api/quiz/user/register - Register for quiz platform
 * - GET /api/quiz/user/balance - Get Chuta balance
 * - GET /api/quiz/user/stats - Get quiz statistics
 * - GET /api/quiz/user/transactions - Get transaction history
 * 
 * Currency Routes:
 * - POST /api/quiz/currency/purchase - Purchase Chuta
 * - POST /api/quiz/currency/withdraw - Withdraw Chuta
 * 
 * Lobby Routes:
 * - POST /api/quiz/lobby/challenge/create - Create challenge
 * - GET /api/quiz/lobby/challenges - List challenges
 * - POST /api/quiz/lobby/challenge/:id/accept - Accept challenge
 * - POST /api/quiz/lobby/challenge/:id/decline - Decline challenge
 * - POST /api/quiz/lobby/challenge/:id/counter - Counter-offer
 * - GET /api/quiz/lobby/match/:id - Get match details
 * - POST /api/quiz/lobby/match/:id/forfeit - Forfeit match
 * 
 * Tournament Routes:
 * - GET /api/quiz/tournaments - List tournaments
 * - GET /api/quiz/tournament/:id - Get tournament details
 * - POST /api/quiz/tournament/:id/register - Register for tournament
 * - POST /api/quiz/tournament/:id/unregister - Unregister from tournament
 * - GET /api/quiz/tournament/:id/leaderboard - Get tournament leaderboard
 * 
 * Leaderboard Routes:
 * - GET /api/quiz/leaderboard/global - Get global leaderboard
 * - GET /api/quiz/leaderboard/lobby - Get lobby leaderboard
 * - GET /api/quiz/leaderboard/tournament - Get tournament leaderboard
 * 
 * Admin Routes:
 * - POST /api/quiz/admin/questions/upload - Upload questions
 * - GET /api/quiz/admin/questions - List questions
 * - PUT /api/quiz/admin/question/:id - Update question
 * - DELETE /api/quiz/admin/question/:id - Delete question
 * - POST /api/quiz/admin/category - Create category
 * - POST /api/quiz/admin/tournament/create - Create tournament
 * - PUT /api/quiz/admin/tournament/:id - Update tournament
 * - POST /api/quiz/admin/tournament/:id/cancel - Cancel tournament
 * - POST /api/quiz/admin/tournament/:id/start - Start tournament
 * - GET /api/quiz/admin/dashboard - Get dashboard stats
 * - POST /api/quiz/admin/user/:id/adjust-balance - Adjust user balance
 */

// ==================== GLOBAL MIDDLEWARE ====================
// Apply input sanitization to all quiz routes except file uploads
router.use((req, res, next) => {
  // Skip sanitizer for multipart/form-data (file uploads) — multer handles those
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    return next();
  }
  return quizInputSanitizer.sanitizeAll()(req, res, next);
});

// ==================== USER ROUTES ====================

/**
 * @route   POST /api/quiz/user/register
 * @desc    Register user for quiz platform (credit initial 100 Chuta bonus)
 * @access  Private
 */
router.post('/user/register', authMiddleware, quizUserController.register);

/**
 * @route   GET /api/quiz/user/balance
 * @desc    Get user's Chuta balance
 * @access  Private
 */
router.get('/user/balance', authMiddleware, quizUserController.getBalance);

/**
 * @route   GET /api/quiz/user/stats
 * @desc    Get user's quiz statistics
 * @access  Private
 */
router.get('/user/stats', authMiddleware, quizUserController.getStats);

/**
 * @route   GET /api/quiz/user/transactions
 * @desc    Get user's transaction history
 * @access  Private
 */
router.get('/user/transactions', authMiddleware, quizUserController.getTransactions);

/**
 * @route   GET /api/quiz/user/check-nickname
 * @desc    Check if a nickname is available (no auth needed)
 * @access  Public
 */
router.get('/user/check-nickname', quizUserController.checkNickname);

/**
 * @route   GET /api/quiz/user/profile/:userId
 * @desc    Get quiz profile (nickname, avatar, stats) for any user
 * @access  Private
 */
router.get('/user/profile/:userId', authMiddleware, quizUserController.getProfile);

/**
 * @route   PATCH /api/quiz/user/profile
 * @desc    Update avatar (anytime) or nickname (2-week cooldown)
 * @access  Private
 */
router.patch('/user/profile', authMiddleware, quizUserController.updateProfile);

// ==================== CURRENCY ROUTES ====================

/**
 * @route   POST /api/quiz/currency/purchase
 * @desc    Purchase Chuta with USD
 * @access  Private
 */
router.post('/currency/purchase', authMiddleware, quizCurrencyController.purchaseCurrency);

/**
 * @route   POST /api/quiz/currency/withdraw
 * @desc    Withdraw Chuta to USD
 * @access  Private
 */
router.post('/currency/withdraw', authMiddleware, quizCurrencyController.withdrawFunds);

// ==================== LOBBY ROUTES ====================

/**
 * @route   POST /api/quiz/lobby/challenge/create
 * @desc    Create a new 1v1 challenge
 * @access  Private
 */
router.post('/lobby/challenge/create', authMiddleware, quizRateLimiter.challengeCreation(), quizLobbyController.createChallenge);

/**
 * @route   GET /api/quiz/lobby/challenges
 * @desc    Get list of available challenges
 * @access  Private
 */
router.get('/lobby/challenges', authMiddleware, quizLobbyController.getChallenges);

/**
 * @route   POST /api/quiz/lobby/challenge/:id/accept
 * @desc    Accept a challenge
 * @access  Private
 */
router.post('/lobby/challenge/:id/accept', authMiddleware, quizLobbyController.acceptChallenge);

/**
 * @route   POST /api/quiz/lobby/challenge/:id/decline
 * @desc    Decline a challenge
 * @access  Private
 */
router.post('/lobby/challenge/:id/decline', authMiddleware, quizLobbyController.declineChallenge);

/**
 * @route   POST /api/quiz/lobby/challenge/:id/counter
 * @desc    Counter-offer a challenge with new wager
 * @access  Private
 */
router.post('/lobby/challenge/:id/counter', authMiddleware, quizLobbyController.counterOffer);

/**
 * @route   POST /api/quiz/lobby/challenge/:id/cancel
 * @desc    Cancel a challenge (by the creator)
 * @access  Private
 */
router.post('/lobby/challenge/:id/cancel', authMiddleware, quizLobbyController.cancelChallenge);

/**
 * @route   GET /api/quiz/lobby/active-match
 * @desc    Get active match for current user (recovery)
 * @access  Private
 */
router.get('/lobby/active-match', authMiddleware, quizLobbyController.getActiveMatch);

/**
 * @route   GET /api/quiz/lobby/match/:id
 * @desc    Get match details
 * @access  Private
 */
router.get('/lobby/match/:id', authMiddleware, quizLobbyController.getMatch);

/**
 * @route   POST /api/quiz/lobby/match/:id/forfeit
 * @desc    Forfeit an active match
 * @access  Private
 */
router.post('/lobby/match/:id/forfeit', authMiddleware, quizLobbyController.forfeitMatch);

/**
 * @route   POST /api/quiz/lobby/match/:id/answer
 * @desc    Submit answer via REST (fallback when socket is down)
 * @access  Private
 */
router.post('/lobby/match/:id/answer', authMiddleware, quizRateLimiter.answerSubmission(), quizLobbyController.submitAnswer);

// ==================== TOURNAMENT ROUTES ====================

/**
 * @route   GET /api/quiz/tournaments
 * @desc    Get list of tournaments
 * @access  Private
 */
router.get('/tournaments', authMiddleware, quizTournamentController.getTournaments);

/**
 * @route   GET /api/quiz/tournament/:id
 * @desc    Get tournament details
 * @access  Private
 */
router.get('/tournament/:id', authMiddleware, quizTournamentController.getTournament);

/**
 * @route   POST /api/quiz/tournament/:id/register
 * @desc    Register for a tournament
 * @access  Private
 */
router.post('/tournament/:id/register', authMiddleware, quizRateLimiter.tournamentRegistration(), quizTournamentController.registerForTournament);

/**
 * @route   POST /api/quiz/tournament/:id/unregister
 * @desc    Unregister from a tournament
 * @access  Private
 */
router.post('/tournament/:id/unregister', authMiddleware, quizTournamentController.unregisterFromTournament);

/**
 * @route   GET /api/quiz/tournament/:id/leaderboard
 * @desc    Get tournament leaderboard
 * @access  Private
 */
router.get('/tournament/:id/leaderboard', authMiddleware, quizTournamentController.getTournamentLeaderboard);

// ==================== LEADERBOARD ROUTES ====================

/**
 * @route   GET /api/quiz/leaderboard/global
 * @desc    Get global leaderboard by total winnings
 * @access  Private
 */
router.get('/leaderboard/global', authMiddleware, quizLeaderboardController.getGlobalLeaderboard);

/**
 * @route   GET /api/quiz/leaderboard/lobby
 * @desc    Get lobby-specific leaderboard
 * @access  Private
 */
router.get('/leaderboard/lobby', authMiddleware, quizLeaderboardController.getLobbyLeaderboard);

/**
 * @route   GET /api/quiz/leaderboard/tournament
 * @desc    Get tournament-specific leaderboard
 * @access  Private
 */
router.get('/leaderboard/tournament', authMiddleware, quizLeaderboardController.getTournamentLeaderboard);

// ==================== ADMIN ROUTES ====================

/**
 * @route   POST /api/quiz/admin/questions/upload
 * @desc    Upload questions via Excel file
 * @access  Admin only
 */
router.post('/admin/questions/upload', authMiddleware, adminMiddleware, upload.any(), quizAdminController.uploadQuestions);

/**
 * @route   GET /api/quiz/admin/questions
 * @desc    Get questions list
 * @access  Admin only
 */
router.get('/admin/questions', authMiddleware, adminMiddleware, quizAdminController.getQuestions);

/**
 * @route   PUT /api/quiz/admin/question/:id
 * @desc    Update a question
 * @access  Admin only
 */
router.put('/admin/question/:id', authMiddleware, adminMiddleware, quizAdminController.updateQuestion);

/**
 * @route   DELETE /api/quiz/admin/question/:id
 * @desc    Delete a question
 * @access  Admin only
 */
router.delete('/admin/question/:id', authMiddleware, adminMiddleware, quizAdminController.deleteQuestion);

/**
 * @route   GET /api/quiz/categories
 * @desc    Get all active quiz categories (for challenge/tournament creation)
 * @access  Private
 */
router.get('/categories', authMiddleware, async (req, res, next) => {
  try {
    const QuizCategory = require('../models/QuizCategory');
    const categories = await QuizCategory.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'description', 'questionCount'],
      order: [['name', 'ASC']]
    });
    res.json({ success: true, categories });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/quiz/admin/category
 * @desc    Create a question category
 * @access  Admin only
 */
router.post('/admin/category', authMiddleware, adminMiddleware, quizAdminController.createCategory);

/**
 * @route   POST /api/quiz/admin/tournament/create
 * @desc    Create a tournament
 * @access  Admin only
 */
router.post('/admin/tournament/create', authMiddleware, adminMiddleware, quizAdminController.createTournament);

/**
 * @route   PUT /api/quiz/admin/tournament/:id
 * @desc    Update a tournament
 * @access  Admin only
 */
router.put('/admin/tournament/:id', authMiddleware, adminMiddleware, quizAdminController.updateTournament);

/**
 * @route   POST /api/quiz/admin/tournament/:id/cancel
 * @desc    Cancel a tournament
 * @access  Admin only
 */
router.post('/admin/tournament/:id/cancel', authMiddleware, adminMiddleware, quizAdminController.cancelTournament);

/**
 * @route   POST /api/quiz/admin/tournament/:id/start
 * @desc    Start a tournament manually
 * @access  Admin only
 */
router.post('/admin/tournament/:id/start', authMiddleware, adminMiddleware, quizAdminController.startTournament);

/**
 * @route   GET /api/quiz/admin/dashboard
 * @desc    Get admin dashboard statistics
 * @access  Admin only
 */
router.get('/admin/dashboard', authMiddleware, adminMiddleware, quizAdminController.getDashboard);

/**
 * @route   POST /api/quiz/admin/user/:id/adjust-balance
 * @desc    Adjust user's Chuta balance
 * @access  Admin only
 */
router.post('/admin/user/:id/adjust-balance', authMiddleware, adminMiddleware, quizAdminController.adjustUserBalance);

// ==================== ACTIVE USERS ROUTE ====================

/**
 * @route   GET /api/quiz/active-users
 * @desc    Get count of active users on quiz platform
 * @access  Public
 */
router.get('/active-users', async (req, res, next) => {
  try {
    const activeUserTracker = require('../services/activeUserTracker');
    const count = await activeUserTracker.getActiveUserCount();
    
    res.json({
      success: true,
      count,
      timestamp: Date.now()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/quiz/lobby/players
 * @desc    Get paginated list of currently online players (for Players screen)
 *          Excludes the requesting user. Returns nickname, avatar, wins, losses.
 * @access  Private
 * @query   page (default 1), limit (default 12)
 */
router.get('/lobby/players', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));

    const websocketManager = require('../services/websocketManager');
    const result = await websocketManager.getOnlinePlayers(userId, page, limit);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// ==================== ERROR HANDLER ====================
// Must be last - catches all errors from quiz routes
router.use(quizErrorHandler);

module.exports = router;
