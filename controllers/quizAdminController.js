const questionService = require('../services/questionService');
const tournamentService = require('../services/tournamentService');
const quizWalletService = require('../services/quizWalletService');
const QuizCategory = require('../models/QuizCategory');

/**
 * Resolve categoryId — accepts either a UUID or a category name string.
 * If a name is passed, looks it up (case-insensitive) and returns the UUID.
 * Returns null if not found.
 */
async function resolveCategoryId(input) {
  if (!input) return null;

  // Check if it looks like a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(input)) return input;

  // Otherwise treat as a name — look it up
  const { Op } = require('sequelize');
  const category = await QuizCategory.findOne({
    where: { name: { [Op.iLike]: input.trim() } }
  });

  return category ? category.id : null;
}

/**
 * Quiz Admin Controller
 * 
 * Handles admin operations:
 * - Question management (upload, CRUD)
 * - Category management
 * - Tournament management
 * - User balance adjustments
 * - Dashboard statistics
 */

/**
 * Upload questions via Excel
 * POST /api/quiz/admin/questions/upload
 */
exports.uploadQuestions = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { categoryId } = req.body;

    console.log('[uploadQuestions] req.file:', req.file ? { fieldname: req.file.fieldname, mimetype: req.file.mimetype, size: req.file.size, originalname: req.file.originalname } : 'UNDEFINED');
    console.log('[uploadQuestions] req.files:', req.files ? req.files.map(f => ({ fieldname: f.fieldname, mimetype: f.mimetype, originalname: f.originalname })) : 'UNDEFINED');
    console.log('[uploadQuestions] req.body:', req.body);
    console.log('[uploadQuestions] Content-Type:', req.headers['content-type']);

    const uploadedFile = req.file || (req.files && req.files[0]);

    if (!uploadedFile) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (!categoryId) {
      return res.status(400).json({ success: false, message: 'categoryId (UUID or name) is required' });
    }

    const resolvedId = await resolveCategoryId(categoryId);
    if (!resolvedId) {
      return res.status(404).json({ success: false, message: `Category not found: "${categoryId}". Create it first via POST /api/quiz/admin/category` });
    }

    const result = await questionService.uploadQuestions(
      adminId,
      uploadedFile.buffer,
      resolvedId,
      uploadedFile.originalname
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Admin Controller] Upload questions error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to upload questions' });
  }
};

/**
 * Get questions list
 * GET /api/quiz/admin/questions
 */
exports.getQuestions = async (req, res) => {
  try {
    const { categoryId, difficulty, page = 1, limit = 20 } = req.query;

    if (!categoryId) {
      return res.status(400).json({ success: false, message: 'categoryId (UUID or name) is required' });
    }

    const resolvedId = await resolveCategoryId(categoryId);
    if (!resolvedId) {
      return res.status(404).json({ success: false, message: `Category not found: "${categoryId}"` });
    }

    const result = await questionService.getQuestionsByCategory(resolvedId, {
      difficulty,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[Quiz Admin Controller] Get questions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to get questions' });
  }
};

/**
 * Update a question
 * PUT /api/quiz/admin/question/:id
 */
exports.updateQuestion = async (req, res) => {
  try {
    const { id: questionId } = req.params;
    const updates = req.body;

    const question = await questionService.updateQuestion(questionId, updates);

    return res.status(200).json({
      success: true,
      question
    });
  } catch (error) {
    console.error('[Quiz Admin Controller] Update question error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update question'
    });
  }
};

/**
 * Delete a question
 * DELETE /api/quiz/admin/question/:id
 */
exports.deleteQuestion = async (req, res) => {
  try {
    const { id: questionId } = req.params;

    await questionService.deleteQuestion(questionId);

    return res.status(200).json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    console.error('[Quiz Admin Controller] Delete question error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete question'
    });
  }
};

/**
 * Create a category
 * POST /api/quiz/admin/category
 */
exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    const category = await QuizCategory.create({
      name,
      description,
      questionCount: 0,
      isActive: true
    });

    return res.status(201).json({
      success: true,
      categoryId: category.id,
      category
    });
  } catch (error) {
    console.error('[Quiz Admin Controller] Create category error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create category'
    });
  }
};

/**
 * Create a tournament
 * POST /api/quiz/admin/tournament/create
 */
exports.createTournament = async (req, res) => {
  try {
    const adminId = req.user.id;
    const config = req.body;

    const result = await tournamentService.createTournament(adminId, config);

    return res.status(201).json(result);
  } catch (error) {
    console.error('[Quiz Admin Controller] Create tournament error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create tournament'
    });
  }
};

/**
 * Update a tournament
 * PUT /api/quiz/admin/tournament/:id
 */
exports.updateTournament = async (req, res) => {
  try {
    const { id: tournamentId } = req.params;
    const updates = req.body;

    const result = await tournamentService.updateTournament(tournamentId, updates);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Admin Controller] Update tournament error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update tournament'
    });
  }
};

/**
 * Cancel a tournament
 * POST /api/quiz/admin/tournament/:id/cancel
 */
exports.cancelTournament = async (req, res) => {
  try {
    const { id: tournamentId } = req.params;
    const { reason } = req.body;

    const result = await tournamentService.cancelTournament(tournamentId, reason);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Admin Controller] Cancel tournament error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel tournament'
    });
  }
};

/**
 * Start a tournament manually
 * POST /api/quiz/admin/tournament/:id/start
 */
exports.startTournament = async (req, res) => {
  try {
    const { id: tournamentId } = req.params;

    const result = await tournamentService.startTournament(tournamentId);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Admin Controller] Start tournament error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to start tournament'
    });
  }
};

/**
 * Get admin dashboard statistics
 * GET /api/quiz/admin/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const QuizMatch = require('../models/QuizMatch');
    const QuizTournament = require('../models/QuizTournament');
    const ChutaCoinTransaction = require('../models/ChutaCoinTransaction');
    const { Op } = require('sequelize');

    // Get active matches count
    const ongoingMatches = await QuizMatch.count({
      where: { status: 'active' }
    });

    // Get upcoming tournaments
    const upcomingTournaments = await QuizTournament.count({
      where: {
        status: 'open',
        startTime: { [Op.gt]: new Date() }
      }
    });

    // Get revenue stats (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const revenueStats = await ChutaCoinTransaction.findAll({
      where: {
        type: { [Op.in]: ['purchase', 'withdrawal'] },
        createdAt: { [Op.gte]: thirtyDaysAgo }
      },
      attributes: [
        'type',
        [require('sequelize').fn('SUM', require('sequelize').col('amount')), 'total']
      ],
      group: ['type']
    });

    return res.status(200).json({
      success: true,
      ongoingMatches,
      upcomingTournaments,
      revenueStats: revenueStats.reduce((acc, stat) => {
        acc[stat.type] = parseFloat(stat.dataValues.total);
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('[Quiz Admin Controller] Get dashboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics'
    });
  }
};

/**
 * Adjust user balance
 * POST /api/quiz/admin/user/:id/adjust-balance
 */
exports.adjustUserBalance = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id: userId } = req.params;
    const { amount, reason } = req.body;

    if (amount === undefined || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: amount, reason'
      });
    }

    const result = await quizWalletService.adjustBalance(
      parseInt(userId),
      amount,
      reason,
      adminId
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Admin Controller] Adjust balance error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to adjust balance'
    });
  }
};

module.exports = exports;
