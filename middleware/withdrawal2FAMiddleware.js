const Withdrawal2FAService = require('../services/withdrawal2FAService');
const User = require('../models/User');

/**
 * Withdrawal 2FA Middleware
 * 
 * Integrates email-based 2FA with withdrawal operations
 */

// Create singleton instance
const withdrawal2FAService = new Withdrawal2FAService();

/**
 * Check if withdrawal requires 2FA and initiate if needed
 * @returns {Function} Express middleware function
 */
function check2FARequirement() {
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

      // Get user tier (you may need to adjust this based on your user model)
      const userTier = req.user.tier || 'default';

      console.log(`[Withdrawal 2FA Middleware] Checking 2FA requirement for user ${userId}: ${amount} ${currency}`);

      // Check if 2FA is required
      const requires2FA = withdrawal2FAService.requires2FA(
        parseFloat(amount),
        currency.toUpperCase(),
        userTier
      );

      if (!requires2FA) {
        // No 2FA required, proceed with normal withdrawal
        console.log(`[Withdrawal 2FA Middleware] No 2FA required for ${amount} ${currency}`);
        return next();
      }

      // 2FA is required - initiate 2FA process
      console.log(`[Withdrawal 2FA Middleware] 2FA required for ${amount} ${currency}`);

      // Fetch full user data from database (req.user only has JWT payload)
      const fullUser = await User.findByPk(req.user.id, {
        attributes: ['id', 'email', 'firstname', 'lastname']
      });

      if (!fullUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const withdrawalData = {
        amount: parseFloat(amount),
        currency: currency.toUpperCase(),
        bankAccount: req.body.bankAccount || {
          bankCode: req.body.bankCode,
          accountNumber: req.body.accountNumber,
          accountName: req.body.accountName,
          bankName: req.body.bankName
        },
        reference: req.body.reference || `withdrawal_${Date.now()}`
      };

      const result = await withdrawal2FAService.initiate2FA(withdrawalData, fullUser);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to initiate withdrawal confirmation'
        });
      }

      // Return 2FA initiation response
      return res.status(202).json({
        success: false, // Not completed yet
        requires2FA: true,
        withdrawalId: result.withdrawalId,
        message: result.message,
        expiresIn: result.expiresIn,
        nextStep: 'verify_otp',
        instructions: 'Check your email for the confirmation code and use the verify-withdrawal endpoint'
      });

    } catch (error) {
      console.error('[Withdrawal 2FA Middleware] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Withdrawal confirmation check failed'
      });
    }
  };
}

/**
 * Middleware exports
 */
const withdrawal2FAMiddleware = {
  // Main 2FA checking middleware
  check2FA: check2FARequirement(),
  
  // Direct access to service for advanced usage
  service: withdrawal2FAService
};

module.exports = withdrawal2FAMiddleware;