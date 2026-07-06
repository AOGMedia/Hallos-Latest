const Withdrawal2FAService = require('../services/withdrawal2FAService');

// Create singleton instance
const withdrawal2FAService = new Withdrawal2FAService();

/**
 * Withdrawal 2FA Controller
 * 
 * Handles email-based 2FA for withdrawal confirmations
 */

/**
 * Verify OTP and get withdrawal data for processing
 * POST /api/wallet/verify-withdrawal
 */
exports.verifyWithdrawalOTP = async (req, res) => {
  try {
    const { withdrawalId, code } = req.body;
    const userId = req.user?.id;

    if (!withdrawalId || !code) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal ID and confirmation code are required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log(`[Withdrawal 2FA Controller] Verifying OTP for withdrawal ${withdrawalId}`);

    const result = await withdrawal2FAService.verifyOTP(withdrawalId, code, userId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // OTP verified successfully - add withdrawal data to request for processing
    req.verifiedWithdrawal = result.withdrawalData;
    req.body = {
      ...req.body,
      ...result.withdrawalData,
      verified2FA: true
    };

    // Continue to actual withdrawal processing
    // This will be handled by the wallet controller
    return res.status(200).json({
      success: true,
      message: result.message,
      withdrawalData: result.withdrawalData,
      nextStep: 'processing_withdrawal'
    });

  } catch (error) {
    console.error('[Withdrawal 2FA Controller] Verify OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify confirmation code'
    });
  }
};

/**
 * Resend OTP for withdrawal
 * POST /api/wallet/resend-withdrawal-otp
 */
exports.resendWithdrawalOTP = async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    const userId = req.user?.id;

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal ID is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log(`[Withdrawal 2FA Controller] Resending OTP for withdrawal ${withdrawalId}`);

    const result = await withdrawal2FAService.resendOTP(withdrawalId, userId, req.user);

    return res.status(result.success ? 200 : 400).json(result);

  } catch (error) {
    console.error('[Withdrawal 2FA Controller] Resend OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend confirmation code'
    });
  }
};

/**
 * Cancel pending withdrawal
 * POST /api/wallet/cancel-withdrawal
 */
exports.cancelWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    const userId = req.user?.id;

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal ID is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log(`[Withdrawal 2FA Controller] Cancelling withdrawal ${withdrawalId}`);

    const result = await withdrawal2FAService.cancelWithdrawal(withdrawalId, userId);

    return res.status(result.success ? 200 : 400).json(result);

  } catch (error) {
    console.error('[Withdrawal 2FA Controller] Cancel withdrawal error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel withdrawal'
    });
  }
};

/**
 * Get withdrawal status
 * GET /api/wallet/withdrawal-status/:withdrawalId
 */
exports.getWithdrawalStatus = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const userId = req.user?.id;

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal ID is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const status = await withdrawal2FAService.getWithdrawalStatus(withdrawalId, userId);

    if (!status) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    return res.status(200).json({
      success: true,
      status
    });

  } catch (error) {
    console.error('[Withdrawal 2FA Controller] Get status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get withdrawal status'
    });
  }
};

/**
 * Get 2FA configuration and thresholds
 * GET /api/wallet/2fa-config
 */
exports.get2FAConfig = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userTier = req.user?.tier || 'default';

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const stats = await withdrawal2FAService.getStatistics();
    const config = stats.config;

    // Calculate thresholds for user's tier
    const thresholds = {};
    for (const [currency, baseThreshold] of Object.entries(config.thresholds)) {
      const multiplier = config.tierMultipliers[userTier] || 1;
      thresholds[currency] = baseThreshold * multiplier;
    }

    return res.status(200).json({
      success: true,
      config: {
        thresholds,
        userTier,
        otpSettings: {
          expiryMinutes: config.otp.expiryMinutes,
          maxAttempts: config.otp.maxAttempts,
          resendCooldownSeconds: config.otp.resendCooldown / 1000
        }
      }
    });

  } catch (error) {
    console.error('[Withdrawal 2FA Controller] Get config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get 2FA configuration'
    });
  }
};

/**
 * Debug endpoint to check stored OTPs (for development/debugging)
 * GET /api/wallet/debug-otps
 */
exports.debugStoredOTPs = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Only allow in development or for specific admin users
    if (process.env.NODE_ENV === 'production' && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Debug endpoint not available in production'
      });
    }

    const debugInfo = await withdrawal2FAService.getDebugInfo(userId);

    return res.status(200).json({
      success: true,
      debug: debugInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Withdrawal 2FA Controller] Debug error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get debug information'
    });
  }
};