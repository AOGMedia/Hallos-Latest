const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/requirePermission');

/**
 * Feedback Routes
 * 
 * User Routes (authenticated):
 * - POST /api/feedback - Submit feedback
 * - GET /api/feedback/status - Check feedback status (for popup logic)
 * - POST /api/feedback/dismiss - Dismiss feedback popup
 * - GET /api/feedback/my-feedback - Get user's feedback history
 * 
 * Admin Routes (admin only):
 * - GET /api/feedback/admin/all - Get all feedback with filters
 * - GET /api/feedback/admin/stats - Get feedback statistics
 * - PATCH /api/feedback/admin/:id - Update feedback status
 * - DELETE /api/feedback/admin/:id - Delete feedback
 */

// ==================== USER ROUTES ====================

/**
 * @route   POST /api/feedback
 * @desc    Submit feedback
 * @access  Private (authenticated users)
 */
router.post('/', authMiddleware, feedbackController.submitFeedback);

/**
 * @route   GET /api/feedback/status
 * @desc    Get user's feedback status (for popup logic)
 * @access  Private (authenticated users)
 */
router.get('/status', authMiddleware, feedbackController.getFeedbackStatus);

/**
 * @route   POST /api/feedback/dismiss
 * @desc    Dismiss feedback popup
 * @access  Private (authenticated users)
 */
router.post('/dismiss', authMiddleware, feedbackController.dismissFeedbackPopup);

/**
 * @route   GET /api/feedback/my-feedback
 * @desc    Get user's feedback history
 * @access  Private (authenticated users)
 */
router.get('/my-feedback', authMiddleware, feedbackController.getMyFeedback);

// ==================== ADMIN ROUTES ====================

/**
 * @route   GET /api/feedback/admin/all
 * @desc    Get all feedback with filters
 * @access  Private (admin only)
 */
router.get('/admin/all', authMiddleware, requirePermission('feedback.view'), feedbackController.getAllFeedback);

/**
 * @route   GET /api/feedback/admin/stats
 * @desc    Get feedback statistics
 * @access  Private (admin only)
 */
router.get('/admin/stats', authMiddleware, requirePermission('feedback.view'), feedbackController.getFeedbackStats);

/**
 * @route   PATCH /api/feedback/admin/:id
 * @desc    Update feedback status
 * @access  Private (admin only)
 */
router.patch('/admin/:id', authMiddleware, requirePermission('feedback.manage'), feedbackController.updateFeedbackStatus);

/**
 * @route   DELETE /api/feedback/admin/:id
 * @desc    Delete feedback
 * @access  Private (admin only)
 */
router.delete('/admin/:id', authMiddleware, requirePermission('feedback.manage'), feedbackController.deleteFeedback);

module.exports = router;
