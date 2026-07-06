const FraudDetectionService = require('../services/fraudDetectionService');

// Create singleton instance
const fraudDetectionService = new FraudDetectionService();

/**
 * Fraud Detection Management Controller
 * 
 * Provides admin endpoints for managing fraud detection:
 * - View statistics and risk profiles
 * - Unblock users
 * - Monitor fraud detection activity
 */

/**
 * Get fraud detection statistics
 * GET /api/admin/fraud-detection/stats
 */
exports.getFraudDetectionStats = async (req, res) => {
  try {
    const stats = fraudDetectionService.getStatistics();
    
    return res.status(200).json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Fraud Detection Controller] Get stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get fraud detection statistics'
    });
  }
};

/**
 * Get user risk profile
 * GET /api/admin/fraud-detection/user/:userId
 */
exports.getUserRiskProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const riskProfile = fraudDetectionService.getUserRiskProfile(parseInt(userId));
    
    return res.status(200).json({
      success: true,
      userId: parseInt(userId),
      riskProfile,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Fraud Detection Controller] Get user risk profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get user risk profile'
    });
  }
};

/**
 * Unblock user from fraud detection
 * POST /api/admin/fraud-detection/unblock-user
 */
exports.unblockUserFromFraudDetection = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    fraudDetectionService.unblockUser(parseInt(userId));
    
    return res.status(200).json({
      success: true,
      message: `User ${userId} has been unblocked from fraud detection`
    });
  } catch (error) {
    console.error('[Fraud Detection Controller] Unblock user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to unblock user'
    });
  }
};

/**
 * Analyze transaction manually (admin tool)
 * POST /api/admin/fraud-detection/analyze
 */
exports.analyzeTransaction = async (req, res) => {
  try {
    const { userId, amount, currency, type, metadata } = req.body;
    
    if (!userId || !amount || !type) {
      return res.status(400).json({
        success: false,
        message: 'userId, amount, and type are required'
      });
    }
    
    const analysis = await fraudDetectionService.analyzeTransaction({
      userId: parseInt(userId),
      amount: parseFloat(amount),
      currency: currency || 'NGN',
      type,
      timestamp: Date.now(),
      metadata: metadata || {}
    });
    
    return res.status(200).json({
      success: true,
      analysis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Fraud Detection Controller] Analyze transaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to analyze transaction'
    });
  }
};

/**
 * Get fraud detection configuration
 * GET /api/admin/fraud-detection/config
 */
exports.getFraudDetectionConfig = async (req, res) => {
  try {
    const stats = fraudDetectionService.getStatistics();
    
    return res.status(200).json({
      success: true,
      config: stats.config,
      description: {
        velocityThresholds: 'Maximum transaction counts and amounts per hour',
        behaviorWindows: 'Time windows for behavioral analysis',
        riskThresholds: 'Risk score thresholds for different actions',
        suspiciousPatterns: 'Patterns that trigger fraud alerts',
        autoBlockThresholds: 'Automatic blocking thresholds'
      }
    });
  } catch (error) {
    console.error('[Fraud Detection Controller] Get config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get fraud detection configuration'
    });
  }
};

/**
 * Get recent suspicious activities
 * GET /api/admin/fraud-detection/suspicious-activities
 */
exports.getSuspiciousActivities = async (req, res) => {
  try {
    const { limit = 50, userId } = req.query;
    
    // This would typically query a database in production
    // For now, return a placeholder response
    const activities = [];
    
    return res.status(200).json({
      success: true,
      activities,
      count: activities.length,
      limit: parseInt(limit),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Fraud Detection Controller] Get suspicious activities error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get suspicious activities'
    });
  }
};