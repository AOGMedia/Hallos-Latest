const WithdrawalLimitService = require('../services/withdrawalLimitService');

// Create singleton instance
const withdrawalLimitService = new WithdrawalLimitService();

/**
 * Withdrawal Limit Management Controller
 * 
 * Provides admin endpoints for managing withdrawal limits:
 * - View user withdrawal statistics
 * - Set custom limits and tiers
 * - Suspend/restore withdrawal privileges
 * - Admin overrides
 */

/**
 * Get withdrawal limit statistics for user
 * GET /api/admin/withdrawal-limits/user/:userId
 */
exports.getUserWithdrawalStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const { currency } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const stats = withdrawalLimitService.getUserWithdrawalStats(
      parseInt(userId),
      currency ? currency.toUpperCase() : null
    );
    
    return res.status(200).json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Get user stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get user withdrawal statistics'
    });
  }
};

/**
 * Get system-wide withdrawal limit statistics
 * GET /api/admin/withdrawal-limits/system-stats
 */
exports.getSystemWithdrawalStats = async (req, res) => {
  try {
    const stats = withdrawalLimitService.getSystemStats();
    
    return res.status(200).json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Get system stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get system withdrawal statistics'
    });
  }
};

/**
 * Set user tier (default, vip, business)
 * POST /api/admin/withdrawal-limits/set-tier
 */
exports.setUserTier = async (req, res) => {
  try {
    const { userId, tier } = req.body;
    
    if (!userId || !tier) {
      return res.status(400).json({
        success: false,
        message: 'User ID and tier are required'
      });
    }
    
    withdrawalLimitService.setUserTier(parseInt(userId), tier);
    
    return res.status(200).json({
      success: true,
      message: `User ${userId} tier set to ${tier}`
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Set tier error:', error);
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Set custom limits for user
 * POST /api/admin/withdrawal-limits/set-custom-limits
 */
exports.setCustomLimits = async (req, res) => {
  try {
    const { userId, currency, limits } = req.body;
    
    if (!userId || !currency || !limits) {
      return res.status(400).json({
        success: false,
        message: 'User ID, currency, and limits are required'
      });
    }
    
    withdrawalLimitService.setCustomLimits(
      parseInt(userId),
      currency.toUpperCase(),
      limits
    );
    
    return res.status(200).json({
      success: true,
      message: `Custom limits set for user ${userId} (${currency})`
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Set custom limits error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to set custom limits'
    });
  }
};

/**
 * Admin override limits for user
 * POST /api/admin/withdrawal-limits/admin-override
 */
exports.adminOverrideLimits = async (req, res) => {
  try {
    const { userId, currency, limits, reason } = req.body;
    
    if (!userId || !currency || !limits || !reason) {
      return res.status(400).json({
        success: false,
        message: 'User ID, currency, limits, and reason are required'
      });
    }
    
    withdrawalLimitService.adminOverrideLimits(
      parseInt(userId),
      currency.toUpperCase(),
      limits,
      reason
    );
    
    return res.status(200).json({
      success: true,
      message: `Admin override set for user ${userId} (${currency})`
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Admin override error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to set admin override'
    });
  }
};

/**
 * Suspend user withdrawal privileges
 * POST /api/admin/withdrawal-limits/suspend-user
 */
exports.suspendUser = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    
    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: 'User ID and reason are required'
      });
    }
    
    withdrawalLimitService.suspendUser(parseInt(userId), reason);
    
    return res.status(200).json({
      success: true,
      message: `User ${userId} withdrawal privileges suspended`
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Suspend user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to suspend user'
    });
  }
};

/**
 * Restore user withdrawal privileges
 * POST /api/admin/withdrawal-limits/restore-user
 */
exports.restoreUser = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    withdrawalLimitService.restoreUser(parseInt(userId));
    
    return res.status(200).json({
      success: true,
      message: `User ${userId} withdrawal privileges restored`
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Restore user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to restore user'
    });
  }
};

/**
 * Reset user to default limits
 * POST /api/admin/withdrawal-limits/reset-user
 */
exports.resetUserToDefault = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    withdrawalLimitService.resetUserToDefault(parseInt(userId));
    
    return res.status(200).json({
      success: true,
      message: `User ${userId} reset to default limits`
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Reset user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset user'
    });
  }
};

/**
 * Check withdrawal limits (preview)
 * POST /api/admin/withdrawal-limits/check-limits
 */
exports.checkWithdrawalLimits = async (req, res) => {
  try {
    const { userId, amount, currency } = req.body;
    
    if (!userId || !amount || !currency) {
      return res.status(400).json({
        success: false,
        message: 'User ID, amount, and currency are required'
      });
    }
    
    const limitCheck = await withdrawalLimitService.checkWithdrawalLimits(
      parseInt(userId),
      parseFloat(amount),
      currency.toUpperCase()
    );
    
    return res.status(200).json({
      success: true,
      limitCheck,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Withdrawal Limit Controller] Check limits error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check withdrawal limits'
    });
  }
};