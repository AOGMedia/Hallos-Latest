const Feedback = require('../models/Feedback');
const User = require('../models/User');
const { Op } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Feedback Controller
 * 
 * Handles user feedback submission and admin management
 * - Submit feedback (authenticated users)
 * - Get feedback status (check if user submitted)
 * - Dismiss feedback popup
 * - Admin: View all feedback with filters
 * - Admin: Update feedback status
 * - Admin: Get feedback statistics
 */

/**
 * Submit feedback
 * POST /api/feedback
 */
exports.submitFeedback = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rating, category, subject, message } = req.body;

    // Validate required fields
    if (!rating || !message) {
      return res.status(400).json({
        success: false,
        message: 'Rating and message are required'
      });
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    // Get user details
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Determine user type based on role
    let userType = 'learner';
    if (user.role === 'admin') {
      userType = 'creator'; // Admins are typically creators
    } else if (user.role === 'creator') {
      userType = 'creator';
    }

    // Create feedback
    const feedback = await Feedback.create({
      userId,
      userType,
      rating,
      category: category || 'general',
      subject: subject || null,
      message,
      status: 'new'
    });

    // Update user's feedback_submitted flag
    await user.update({ feedbackSubmitted: true });

    return res.status(201).json({
      success: true,
      message: 'Thank you for your feedback! We appreciate your input.',
      feedback: {
        id: feedback.id,
        rating: feedback.rating,
        category: feedback.category,
        subject: feedback.subject,
        message: feedback.message,
        createdAt: feedback.createdAt
      }
    });
  } catch (error) {
    console.error('[Feedback Controller] Submit feedback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit feedback'
    });
  }
};

/**
 * Get user's feedback status
 * GET /api/feedback/status
 */
exports.getFeedbackStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: ['feedbackSubmitted', 'feedbackDismissedAt', 'createdAt']
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Calculate if user should see popup
    // Show popup if:
    // 1. User hasn't submitted feedback
    // 2. User hasn't dismissed popup in last 30 days
    // 3. User account is at least 24 hours old

    const accountAge = Date.now() - new Date(user.createdAt).getTime();
    const oneDayInMs = 24 * 60 * 60 * 1000;
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;

    let shouldShowPopup = false;

    if (!user.feedbackSubmitted && accountAge >= oneDayInMs) {
      if (!user.feedbackDismissedAt) {
        shouldShowPopup = true;
      } else {
        const timeSinceDismissed = Date.now() - new Date(user.feedbackDismissedAt).getTime();
        if (timeSinceDismissed >= thirtyDaysInMs) {
          shouldShowPopup = true;
        }
      }
    }

    return res.json({
      success: true,
      status: {
        hasSubmittedFeedback: user.feedbackSubmitted,
        shouldShowPopup,
        dismissedAt: user.feedbackDismissedAt,
        accountCreatedAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('[Feedback Controller] Get feedback status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get feedback status'
    });
  }
};

/**
 * Dismiss feedback popup
 * POST /api/feedback/dismiss
 */
exports.dismissFeedbackPopup = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.update({ feedbackDismissedAt: new Date() });

    return res.json({
      success: true,
      message: 'Feedback popup dismissed'
    });
  } catch (error) {
    console.error('[Feedback Controller] Dismiss feedback popup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to dismiss feedback popup'
    });
  }
};

/**
 * Get user's feedback history
 * GET /api/feedback/my-feedback
 */
exports.getMyFeedback = async (req, res) => {
  try {
    const userId = req.user.id;

    const feedbackList = await Feedback.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'rating', 'category', 'subject', 'message', 'status', 'createdAt']
    });

    return res.json({
      success: true,
      count: feedbackList.length,
      feedback: feedbackList
    });
  } catch (error) {
    console.error('[Feedback Controller] Get my feedback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get feedback history'
    });
  }
};

/**
 * ADMIN: Get all feedback with filters
 * GET /api/feedback/admin/all
 */
exports.getAllFeedback = async (req, res) => {
  try {
    const { status, rating, userType, category, page = 1, limit = 20 } = req.query;

    // Build filter conditions
    const where = {};
    if (status) where.status = status;
    if (rating) where.rating = parseInt(rating);
    if (userType) where.userType = userType;
    if (category) where.category = category;

    const offset = (page - 1) * limit;

    const { count, rows: feedbackList } = await Feedback.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email', 'role']
        },
        {
          model: User,
          as: 'reviewer',
          attributes: ['id', 'firstname', 'lastname', 'email'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.json({
      success: true,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      },
      feedback: feedbackList
    });
  } catch (error) {
    console.error('[Feedback Controller] Get all feedback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get feedback'
    });
  }
};

/**
 * ADMIN: Update feedback status
 * PATCH /api/feedback/admin/:id
 */
exports.updateFeedbackStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { status, adminNotes } = req.body;

    // Validate status
    const validStatuses = ['new', 'reviewed', 'in_progress', 'resolved', 'dismissed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const feedback = await Feedback.findByPk(id);
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    // Build update object
    const updates = {};
    if (status) {
      updates.status = status;
      updates.reviewedBy = adminId;
      updates.reviewedAt = new Date();
    }
    if (adminNotes !== undefined) {
      updates.adminNotes = adminNotes;
    }

    await feedback.update(updates);

    // Fetch updated feedback with user details
    const updatedFeedback = await Feedback.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email', 'role']
        },
        {
          model: User,
          as: 'reviewer',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ]
    });

    return res.json({
      success: true,
      message: 'Feedback updated successfully',
      feedback: updatedFeedback
    });
  } catch (error) {
    console.error('[Feedback Controller] Update feedback status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update feedback'
    });
  }
};

/**
 * ADMIN: Get feedback statistics
 * GET /api/feedback/admin/stats
 */
exports.getFeedbackStats = async (req, res) => {
  try {
    // Total feedback count
    const totalFeedback = await Feedback.count();

    // Count by status
    const statusCounts = await Feedback.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Count by rating
    const ratingCounts = await Feedback.findAll({
      attributes: [
        'rating',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['rating'],
      order: [['rating', 'ASC']],
      raw: true
    });

    // Count by user type
    const userTypeCounts = await Feedback.findAll({
      attributes: [
        'userType',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['userType'],
      raw: true
    });

    // Count by category
    const categoryCounts = await Feedback.findAll({
      attributes: [
        'category',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['category'],
      raw: true
    });

    // Average rating
    const avgRating = await Feedback.findOne({
      attributes: [
        [sequelize.fn('AVG', sequelize.col('rating')), 'average']
      ],
      raw: true
    });

    // Recent feedback (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentFeedbackCount = await Feedback.count({
      where: {
        createdAt: {
          [Op.gte]: sevenDaysAgo
        }
      }
    });

    return res.json({
      success: true,
      stats: {
        total: totalFeedback,
        averageRating: parseFloat(avgRating.average || 0).toFixed(2),
        recentFeedback: recentFeedbackCount,
        byStatus: statusCounts.reduce((acc, item) => {
          acc[item.status] = parseInt(item.count);
          return acc;
        }, {}),
        byRating: ratingCounts.reduce((acc, item) => {
          acc[item.rating] = parseInt(item.count);
          return acc;
        }, {}),
        byUserType: userTypeCounts.reduce((acc, item) => {
          acc[item.userType] = parseInt(item.count);
          return acc;
        }, {}),
        byCategory: categoryCounts.reduce((acc, item) => {
          acc[item.category] = parseInt(item.count);
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('[Feedback Controller] Get feedback stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get feedback statistics'
    });
  }
};

/**
 * ADMIN: Delete feedback
 * DELETE /api/feedback/admin/:id
 */
exports.deleteFeedback = async (req, res) => {
  try {
    const { id } = req.params;

    const feedback = await Feedback.findByPk(id);
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    await feedback.destroy();

    return res.json({
      success: true,
      message: 'Feedback deleted successfully'
    });
  } catch (error) {
    console.error('[Feedback Controller] Delete feedback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete feedback'
    });
  }
};
