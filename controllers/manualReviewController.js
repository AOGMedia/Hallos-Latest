const ManualReviewService = require('../services/manualReviewService');

// Create singleton instance
const manualReviewService = new ManualReviewService();

/**
 * Manual Review Controller
 * 
 * Handles manual review queue operations:
 * - Queue management
 * - Reviewer assignment
 * - Review decisions
 * - Statistics and reporting
 */

/**
 * Get review queue for reviewer
 * GET /api/admin/review/queue
 */
exports.getReviewQueue = async (req, res) => {
  try {
    const reviewerId = req.user?.id;
    const { priority, type, status } = req.query;

    if (!reviewerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const filters = { priority, type, status };
    const queue = manualReviewService.getReviewerQueue(reviewerId, filters);

    return res.status(200).json({
      success: true,
      queue,
      count: queue.length,
      filters,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Manual Review Controller] Get queue error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get review queue'
    });
  }
};

/**
 * Get specific review item
 * GET /api/admin/review/item/:reviewId
 */
exports.getReviewItem = async (req, res) => {
  try {
    const { reviewId } = req.params;

    if (!reviewId) {
      return res.status(400).json({
        success: false,
        message: 'Review ID is required'
      });
    }

    const reviewItem = manualReviewService.getReviewItem(reviewId);

    if (!reviewItem) {
      return res.status(404).json({
        success: false,
        message: 'Review item not found'
      });
    }

    return res.status(200).json({
      success: true,
      reviewItem
    });
  } catch (error) {
    console.error('[Manual Review Controller] Get item error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get review item'
    });
  }
};

/**
 * Assign reviewer to review item
 * POST /api/admin/review/assign
 */
exports.assignReviewer = async (req, res) => {
  try {
    const { reviewId, reviewerId } = req.body;
    const currentUserId = req.user?.id;

    if (!reviewId || !reviewerId) {
      return res.status(400).json({
        success: false,
        message: 'Review ID and reviewer ID are required'
      });
    }

    const result = await manualReviewService.assignReviewer(reviewId, reviewerId);

    if (result.success) {
      // Log assignment action
      console.log(`[Manual Review] User ${currentUserId} assigned reviewer ${reviewerId} to review ${reviewId}`);
    }

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error('[Manual Review Controller] Assign reviewer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign reviewer'
    });
  }
};

/**
 * Submit review decision
 * POST /api/admin/review/decision
 */
exports.submitDecision = async (req, res) => {
  try {
    const { reviewId, action, notes, metadata } = req.body;
    const reviewerId = req.user?.id;

    if (!reviewId || !action) {
      return res.status(400).json({
        success: false,
        message: 'Review ID and action are required'
      });
    }

    if (!['approve', 'reject', 'escalate'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be approve, reject, or escalate'
      });
    }

    const decision = {
      reviewerId,
      action,
      notes,
      metadata
    };

    const result = await manualReviewService.submitDecision(reviewId, decision);

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error('[Manual Review Controller] Submit decision error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit review decision'
    });
  }
};

/**
 * Add item to review queue
 * POST /api/admin/review/add
 */
exports.addToQueue = async (req, res) => {
  try {
    const {
      transactionId,
      userId,
      type,
      priority = 'medium',
      data,
      metadata,
      flaggedBy = 'manual'
    } = req.body;

    if (!transactionId || !type) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID and type are required'
      });
    }

    const reviewItem = {
      transactionId,
      userId,
      type,
      priority,
      data,
      metadata: {
        ...metadata,
        addedBy: req.user?.id
      },
      flaggedBy
    };

    const result = await manualReviewService.addToQueue(reviewItem);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Manual Review Controller] Add to queue error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add item to review queue'
    });
  }
};

/**
 * Get review statistics
 * GET /api/admin/review/stats
 */
exports.getReviewStats = async (req, res) => {
  try {
    const { startDate, endDate, reviewerId } = req.query;

    const filters = {
      startDate,
      endDate,
      reviewerId: reviewerId ? parseInt(reviewerId) : undefined
    };

    const stats = manualReviewService.getReviewStatistics(filters);

    return res.status(200).json({
      success: true,
      stats,
      filters,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Manual Review Controller] Get stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get review statistics'
    });
  }
};

/**
 * Get service statistics
 * GET /api/admin/review/service-stats
 */
exports.getServiceStats = async (req, res) => {
  try {
    const stats = manualReviewService.getServiceStatistics();

    return res.status(200).json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Manual Review Controller] Get service stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get service statistics'
    });
  }
};

/**
 * Get reviewer workload
 * GET /api/admin/review/workload/:reviewerId
 */
exports.getReviewerWorkload = async (req, res) => {
  try {
    const { reviewerId } = req.params;

    if (!reviewerId) {
      return res.status(400).json({
        success: false,
        message: 'Reviewer ID is required'
      });
    }

    const workload = manualReviewService.getReviewerWorkload(parseInt(reviewerId));
    const queue = manualReviewService.getReviewerQueue(parseInt(reviewerId));

    return res.status(200).json({
      success: true,
      reviewerId: parseInt(reviewerId),
      workload,
      activeReviews: queue.length,
      queue: queue.slice(0, 10) // Return first 10 items
    });
  } catch (error) {
    console.error('[Manual Review Controller] Get workload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get reviewer workload'
    });
  }
};

/**
 * Get review configuration
 * GET /api/admin/review/config
 */
exports.getReviewConfig = async (req, res) => {
  try {
    const stats = manualReviewService.getServiceStatistics();

    return res.status(200).json({
      success: true,
      config: {
        priorities: stats.config.priorities,
        statuses: stats.config.statuses,
        types: stats.config.types,
        slaMinutes: stats.config.slaMinutes,
        escalation: stats.config.escalation
      }
    });
  } catch (error) {
    console.error('[Manual Review Controller] Get config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get review configuration'
    });
  }
};