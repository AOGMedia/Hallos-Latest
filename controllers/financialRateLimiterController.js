const { getStatistics, unblockUser, unblockIP } = require('../middleware/financialRateLimiter');

/**
 * Financial Rate Limiter Management Controller
 * 
 * Provides admin endpoints for managing financial rate limiting:
 * - View statistics and current limits
 * - Unblock users and IPs
 * - Monitor rate limiting activity
 */

/**
 * Get rate limiting statistics
 * GET /api/admin/rate-limiter/stats
 */
exports.getRateLimiterStats = async (req, res) => {
  try {
    const stats = getStatistics();
    
    return res.status(200).json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Rate Limiter Controller] Get stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get rate limiter statistics'
    });
  }
};

/**
 * Unblock user from rate limiting
 * POST /api/admin/rate-limiter/unblock-user
 */
exports.unblockUserFromRateLimit = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    unblockUser(parseInt(userId));
    
    return res.status(200).json({
      success: true,
      message: `User ${userId} has been unblocked from rate limiting`
    });
  } catch (error) {
    console.error('[Rate Limiter Controller] Unblock user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to unblock user'
    });
  }
};

/**
 * Unblock IP from rate limiting
 * POST /api/admin/rate-limiter/unblock-ip
 */
exports.unblockIPFromRateLimit = async (req, res) => {
  try {
    const { ip } = req.body;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        message: 'IP address is required'
      });
    }
    
    unblockIP(ip);
    
    return res.status(200).json({
      success: true,
      message: `IP ${ip} has been unblocked from rate limiting`
    });
  } catch (error) {
    console.error('[Rate Limiter Controller] Unblock IP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to unblock IP'
    });
  }
};

/**
 * Get rate limiting configuration
 * GET /api/admin/rate-limiter/config
 */
exports.getRateLimiterConfig = async (req, res) => {
  try {
    const stats = getStatistics();
    
    return res.status(200).json({
      success: true,
      config: stats.config,
      description: {
        userLimits: 'Per-user limits per hour',
        ipLimits: 'Per-IP limits per hour',
        windowSize: 'Time window in milliseconds',
        operations: {
          deposits: 'Deposit operations',
          withdrawals: 'Withdrawal operations', 
          transfers: 'Transfer operations',
          payments: 'Payment operations',
          wallet_operations: 'General wallet operations'
        }
      }
    });
  } catch (error) {
    console.error('[Rate Limiter Controller] Get config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get rate limiter configuration'
    });
  }
};