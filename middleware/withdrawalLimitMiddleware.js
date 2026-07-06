const WithdrawalLimitService = require('../services/withdrawalLimitService');

/**
 * Withdrawal Limit Middleware
 * 
 * Integrates withdrawal limit checking with withdrawal operations
 */

// Create singleton instance
const withdrawalLimitService = new WithdrawalLimitService();

/**
 * Create withdrawal limit middleware
 * @returns {Function} Express middleware function
 */
function createWithdrawalLimitMiddleware() {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { amount, currency = 'NGN' } = req.body;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid withdrawal amount is required'
        });
      }

      console.log(`[Withdrawal Limit Middleware] Checking limits for user ${userId}: ${amount} ${currency}`);

      // Check withdrawal limits
      const limitCheck = await withdrawalLimitService.checkWithdrawalLimits(
        userId,
        parseFloat(amount),
        currency.toUpperCase()
      );

      // Add limit check result to request for logging
      req.withdrawalLimitCheck = limitCheck;

      // Handle limit check result
      if (!limitCheck.allowed) {
        console.warn(`[Withdrawal Limit Middleware] Withdrawal blocked for user ${userId}:`, limitCheck);
        
        return res.status(403).json({
          success: false,
          message: limitCheck.reason,
          type: limitCheck.type,
          limits: limitCheck.limits,
          usage: limitCheck.usage,
          exceeded: limitCheck.exceeded
        });
      }

      // Add limit information to response headers
      if (limitCheck.limits && limitCheck.remaining) {
        res.set({
          'X-Daily-Limit': limitCheck.limits.daily.toString(),
          'X-Monthly-Limit': limitCheck.limits.monthly.toString(),
          'X-Daily-Remaining': limitCheck.remaining.daily.toString(),
          'X-Monthly-Remaining': limitCheck.remaining.monthly.toString()
        });
      }

      // Store withdrawal limit service in request for post-processing
      req.withdrawalLimitService = withdrawalLimitService;

      console.log(`[Withdrawal Limit Middleware] Withdrawal approved for user ${userId}: ${amount} ${currency}`);
      next();
    } catch (error) {
      console.error('[Withdrawal Limit Middleware] Error:', error);
      // On error, deny withdrawal for safety
      return res.status(500).json({
        success: false,
        message: 'Withdrawal limit check failed - withdrawal denied for safety',
        type: 'limit_check_error'
      });
    }
  };
}

/**
 * Middleware to record successful withdrawal
 * Call this AFTER the withdrawal has been successfully processed
 * @returns {Function} Express middleware function
 */
function recordWithdrawalMiddleware() {
  return async (req, res, next) => {
    try {
      // Only record if withdrawal was successful
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.user?.id;
        const { amount, currency = 'NGN', reference } = req.body;
        
        if (userId && amount && req.withdrawalLimitService) {
          await req.withdrawalLimitService.recordWithdrawal(
            userId,
            parseFloat(amount),
            currency.toUpperCase(),
            reference || `withdrawal_${Date.now()}`
          );
          
          console.log(`[Withdrawal Limit Middleware] Recorded withdrawal for user ${userId}: ${amount} ${currency}`);
        }
      }
      
      next();
    } catch (error) {
      console.error('[Withdrawal Limit Middleware] Record error:', error);
      // Don't fail the response, just log the error
      next();
    }
  };
}

/**
 * Middleware exports
 */
const withdrawalLimitMiddleware = {
  // Main limit checking middleware
  checkLimits: createWithdrawalLimitMiddleware(),
  
  // Post-processing middleware to record successful withdrawals
  recordWithdrawal: recordWithdrawalMiddleware(),
  
  // Direct access to service for advanced usage
  service: withdrawalLimitService
};

module.exports = withdrawalLimitMiddleware;