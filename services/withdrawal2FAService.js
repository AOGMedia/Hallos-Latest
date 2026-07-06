const { sendWithdrawalOTP } = require('../utils/email');
const WithdrawalOTP = require('../models/WithdrawalOTP');
const { Op } = require('sequelize');

/**
 * Withdrawal Two-Factor Authentication Service
 * 
 * Provides email-based 2FA for withdrawal confirmations:
 * - OTP generation and storage (now persistent in database)
 * - Email delivery via existing nodemailer setup
 * - OTP verification and expiration
 * - Threshold-based 2FA requirements
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

class Withdrawal2FAService {
  constructor() {
    // 2FA configuration
    this.config = {
      // Thresholds for requiring 2FA (amounts above these require email confirmation)
      thresholds: {
        NGN: 100000,  // ₦100,000 (~$120)
        USD: 500      // $500
      },
      
      // OTP settings
      otp: {
        length: 6,                    // 6-digit OTP
        expiryMinutes: 10,           // 10 minutes expiry
        maxAttempts: 3,              // Max 3 verification attempts
        resendCooldown: 2 * 60 * 1000 // 2 minutes between resends
      },
      
      // User tier multipliers for thresholds
      tierMultipliers: {
        default: 1,    // Normal thresholds
        vip: 2,        // 2x higher thresholds
        business: 5    // 5x higher thresholds
      }
    };

    // Start cleanup interval for expired OTPs
    this.startCleanupInterval();
  }

  /**
   * Check if withdrawal requires 2FA
   * @param {number} amount - Withdrawal amount
   * @param {string} currency - Currency code
   * @param {string} userTier - User tier (default, vip, business)
   * @returns {boolean} True if 2FA is required
   */
  requires2FA(amount, currency, userTier = 'default') {
    const baseThreshold = this.config.thresholds[currency] || this.config.thresholds.USD;
    const multiplier = this.config.tierMultipliers[userTier] || 1;
    const threshold = baseThreshold * multiplier;
    
    return amount >= threshold;
  }

  /**
   * Initiate 2FA for withdrawal
   * @param {Object} withdrawalData - Withdrawal request data
   * @param {Object} user - User object
   * @returns {Promise<Object>} 2FA initiation result
   */
  async initiate2FA(withdrawalData, user) {
    try {
      const { amount, currency, bankAccount, reference } = withdrawalData;
      
      // Debug logging to see what's in the user object
      console.log(`[Withdrawal 2FA] User object received:`, JSON.stringify(user, null, 2));
      
      const { id: userId, email, firstname } = user;

      // Validate required user fields
      if (!email) {
        throw new Error('User email is required for 2FA');
      }
      
      if (!firstname) {
        console.log(`[Withdrawal 2FA] Warning: firstname not available for user ${userId}, using fallback`);
      }

      console.log(`[Withdrawal 2FA] Initiating 2FA for user ${userId} (${email}): ${amount} ${currency}`);

      // Generate withdrawal ID and OTP
      const withdrawalId = this.generateWithdrawalId();
      const otp = this.generateOTP();
      const expiresAt = new Date(Date.now() + (this.config.otp.expiryMinutes * 60 * 1000));
      
      // Store OTP in database
      const otpRecord = await WithdrawalOTP.create({
        withdrawalId,
        userId,
        code: otp,
        amount,
        currency,
        bankAccount,
        reference,
        attempts: 0,
        maxAttempts: this.config.otp.maxAttempts,
        status: 'pending',
        expiresAt
      });

      // Debug logging to confirm OTP storage
      console.log(`[Withdrawal 2FA] OTP stored successfully in database:`);
      console.log(`  - withdrawalId: ${withdrawalId}`);
      console.log(`  - OTP code: ${otp}`);
      console.log(`  - userId: ${userId}`);
      console.log(`  - expiresAt: ${expiresAt.toISOString()}`);
      console.log(`  - Database record ID: ${otpRecord.id}`);

      // Send OTP email
      await sendWithdrawalOTP(
        email,
        firstname || 'User', // Fallback if firstname is not available
        otp,
        amount,
        currency,
        this.formatBankAccount(bankAccount)
      );

      console.log(`[Withdrawal 2FA] OTP sent to ${email} for withdrawal ${withdrawalId}`);

      return {
        success: true,
        withdrawalId,
        message: `Confirmation code sent to ${this.maskEmail(email)}`,
        expiresIn: this.config.otp.expiryMinutes * 60, // seconds
        resendAvailable: true
      };
    } catch (error) {
      console.error('[Withdrawal 2FA] Initiation error:', error);
      console.error('[Withdrawal 2FA] Error stack:', error.stack);
      
      throw new Error('Failed to initiate withdrawal confirmation');
    }
  }

  /**
   * Verify OTP and complete withdrawal
   * @param {string} withdrawalId - Withdrawal ID
   * @param {string} code - OTP code provided by user
   * @param {number} userId - User ID for security check
   * @returns {Promise<Object>} Verification result
   */
  async verifyOTP(withdrawalId, code, userId) {
    try {
      console.log(`[Withdrawal 2FA] Verifying OTP for withdrawal ${withdrawalId}`);
      console.log(`[Withdrawal 2FA] Looking for OTP with:`);
      console.log(`  - withdrawalId: ${withdrawalId}`);
      console.log(`  - code: ${code}`);
      console.log(`  - userId: ${userId}`);
      
      // Get total count of active OTPs for debugging
      const totalOTPs = await WithdrawalOTP.count({
        where: {
          status: 'pending',
          expiresAt: {
            [Op.gt]: new Date()
          }
        }
      });
      console.log(`  - Total active OTPs in database: ${totalOTPs}`);

      // Find OTP record in database
      const otpRecord = await WithdrawalOTP.findOne({
        where: {
          withdrawalId,
          status: 'pending'
        }
      });

      console.log(`[Withdrawal 2FA] Found OTP record:`, otpRecord ? 'YES' : 'NO');
      
      if (!otpRecord) {
        console.log(`[Withdrawal 2FA] OTP not found for withdrawalId: ${withdrawalId}`);
        
        // Check if user has any active OTPs
        const userOTPs = await WithdrawalOTP.findAll({
          where: {
            userId,
            status: 'pending',
            expiresAt: {
              [Op.gt]: new Date()
            }
          },
          attributes: ['withdrawalId', 'expiresAt', 'amount', 'currency'],
          order: [['createdAt', 'DESC']]
        });
        
        console.log(`[Withdrawal 2FA] User ${userId} has ${userOTPs.length} active OTPs`);
        
        if (userOTPs.length > 0) {
          return {
            success: false,
            message: `Invalid withdrawal ID. You have ${userOTPs.length} active withdrawal(s). Please use the correct withdrawal ID from your latest withdrawal request.`,
            error: 'wrong_withdrawal_id',
            availableWithdrawals: userOTPs.map(otp => ({
              withdrawalId: otp.withdrawalId,
              amount: otp.amount,
              currency: otp.currency,
              expiresAt: otp.expiresAt.toISOString()
            }))
          };
        } else {
          return {
            success: false,
            message: 'No active withdrawal requests found. Please initiate a new withdrawal first.',
            error: 'no_active_withdrawals'
          };
        }
      }

      // Check if OTP belongs to the user
      if (otpRecord.userId !== userId) {
        console.log(`[Withdrawal 2FA] User mismatch: OTP belongs to user ${otpRecord.userId}, but request from user ${userId}`);
        return {
          success: false,
          message: 'Invalid confirmation code',
          error: 'user_mismatch'
        };
      }

      // Check if OTP has expired
      if (new Date() > otpRecord.expiresAt) {
        console.log(`[Withdrawal 2FA] OTP expired at ${otpRecord.expiresAt.toISOString()}`);
        await otpRecord.update({ status: 'expired' });
        return {
          success: false,
          message: 'Confirmation code has expired. Please request a new one.',
          error: 'otp_expired'
        };
      }

      // Check attempt limit
      if (otpRecord.attempts >= otpRecord.maxAttempts) {
        console.log(`[Withdrawal 2FA] Max attempts exceeded: ${otpRecord.attempts}/${otpRecord.maxAttempts}`);
        await otpRecord.update({ status: 'failed' });
        return {
          success: false,
          message: 'Too many failed attempts. Please start a new withdrawal.',
          error: 'max_attempts_exceeded'
        };
      }

      // Verify OTP code
      const providedCode = code.toString().trim();
      const storedCode = otpRecord.code.toString().trim();
      
      console.log(`[Withdrawal 2FA] Comparing codes: provided="${providedCode}", stored="${storedCode}"`);
      
      if (storedCode !== providedCode) {
        const newAttempts = otpRecord.attempts + 1;
        await otpRecord.update({ attempts: newAttempts });
        
        console.log(`[Withdrawal 2FA] Invalid code. Attempts: ${newAttempts}/${otpRecord.maxAttempts}`);
        
        const remainingAttempts = otpRecord.maxAttempts - newAttempts;
        
        return {
          success: false,
          message: `Invalid confirmation code. ${remainingAttempts} attempts remaining.`,
          error: 'invalid_code',
          remainingAttempts
        };
      }

      // OTP is valid - mark as verified and return withdrawal data
      await otpRecord.update({ 
        status: 'verified',
        verifiedAt: new Date()
      });

      const withdrawalData = {
        id: otpRecord.withdrawalId,
        userId: otpRecord.userId,
        amount: parseFloat(otpRecord.amount),
        currency: otpRecord.currency,
        bankAccount: otpRecord.bankAccount,
        reference: otpRecord.reference,
        status: 'verified'
      };

      console.log(`[Withdrawal 2FA] OTP verified successfully for withdrawal ${withdrawalId}`);

      return {
        success: true,
        message: 'Withdrawal confirmed successfully',
        withdrawalData
      };
    } catch (error) {
      console.error('[Withdrawal 2FA] Verification error:', error);
      return {
        success: false,
        message: 'Verification failed. Please try again.',
        error: 'verification_error'
      };
    }
  }

  /**
   * Resend OTP for withdrawal
   * @param {string} withdrawalId - Withdrawal ID
   * @param {number} userId - User ID for security check
   * @param {Object} user - User object for email
   * @returns {Promise<Object>} Resend result
   */
  async resendOTP(withdrawalId, userId, user) {
    try {
      console.log(`[Withdrawal 2FA] Resending OTP for withdrawal ${withdrawalId}`);

      // Find OTP record in database
      const otpRecord = await WithdrawalOTP.findOne({
        where: {
          withdrawalId,
          userId,
          status: 'pending'
        }
      });

      if (!otpRecord) {
        return {
          success: false,
          message: 'Withdrawal request not found',
          error: 'withdrawal_not_found'
        };
      }

      // Check if withdrawal has expired
      if (new Date() > otpRecord.expiresAt) {
        await otpRecord.update({ status: 'expired' });
        return {
          success: false,
          message: 'Withdrawal request has expired. Please start a new withdrawal.',
          error: 'withdrawal_expired'
        };
      }

      // Check resend cooldown
      if (otpRecord.lastResendAt) {
        const timeSinceLastResend = Date.now() - otpRecord.lastResendAt.getTime();
        if (timeSinceLastResend < this.config.otp.resendCooldown) {
          const remainingTime = Math.ceil((this.config.otp.resendCooldown - timeSinceLastResend) / 1000);
          return {
            success: false,
            message: `Please wait ${remainingTime} seconds before requesting a new code`,
            error: 'resend_cooldown'
          };
        }
      }

      // Generate new OTP
      const newOTP = this.generateOTP();
      
      // Update OTP record
      await otpRecord.update({
        code: newOTP,
        attempts: 0, // Reset attempts
        lastResendAt: new Date()
      });

      // Send new OTP email
      await sendWithdrawalOTP(
        user.email,
        user.firstname,
        newOTP,
        parseFloat(otpRecord.amount),
        otpRecord.currency,
        this.formatBankAccount(otpRecord.bankAccount)
      );

      console.log(`[Withdrawal 2FA] New OTP sent to ${user.email} for withdrawal ${withdrawalId}`);

      return {
        success: true,
        message: `New confirmation code sent to ${this.maskEmail(user.email)}`,
        expiresIn: this.config.otp.expiryMinutes * 60
      };
    } catch (error) {
      console.error('[Withdrawal 2FA] Resend error:', error);
      return {
        success: false,
        message: 'Failed to resend confirmation code',
        error: 'resend_error'
      };
    }
  }

  /**
   * Cancel pending withdrawal
   * @param {string} withdrawalId - Withdrawal ID
   * @param {number} userId - User ID for security check
   * @returns {Promise<Object>} Cancellation result
   */
  async cancelWithdrawal(withdrawalId, userId) {
    try {
      const otpRecord = await WithdrawalOTP.findOne({
        where: {
          withdrawalId,
          userId,
          status: 'pending'
        }
      });
      
      if (!otpRecord) {
        return {
          success: false,
          message: 'Withdrawal request not found',
          error: 'withdrawal_not_found'
        };
      }

      // Mark as cancelled (we'll use 'failed' status for cancelled)
      await otpRecord.update({ status: 'failed' });

      console.log(`[Withdrawal 2FA] Withdrawal ${withdrawalId} cancelled by user ${userId}`);

      return {
        success: true,
        message: 'Withdrawal cancelled successfully'
      };
    } catch (error) {
      console.error('[Withdrawal 2FA] Cancel error:', error);
      return {
        success: false,
        message: 'Failed to cancel withdrawal',
        error: 'cancel_error'
      };
    }
  }

  /**
   * Get withdrawal status
   * @param {string} withdrawalId - Withdrawal ID
   * @param {number} userId - User ID for security check
   * @returns {Promise<Object|null>} Withdrawal status
   */
  async getWithdrawalStatus(withdrawalId, userId) {
    try {
      const otpRecord = await WithdrawalOTP.findOne({
        where: {
          withdrawalId,
          userId
        }
      });
      
      if (!otpRecord) {
        return null;
      }

      return {
        withdrawalId: otpRecord.withdrawalId,
        amount: parseFloat(otpRecord.amount),
        currency: otpRecord.currency,
        status: otpRecord.status,
        expiresAt: otpRecord.expiresAt,
        remainingAttempts: otpRecord.maxAttempts - otpRecord.attempts,
        createdAt: otpRecord.createdAt,
        verifiedAt: otpRecord.verifiedAt
      };
    } catch (error) {
      console.error('[Withdrawal 2FA] Get status error:', error);
      return null;
    }
  }

  /**
   * Generate withdrawal ID
   * @returns {string} Unique withdrawal ID
   */
  generateWithdrawalId() {
    return `wd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate OTP code
   * @returns {string} 6-digit OTP
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Format bank account for display
   * @param {string|Object} bankAccount - Bank account info
   * @returns {string} Formatted bank account
   */
  formatBankAccount(bankAccount) {
    if (typeof bankAccount === 'string') {
      return bankAccount;
    }
    
    if (bankAccount && bankAccount.accountNumber) {
      // Handle NGN format (bankCode)
      if (bankAccount.bankCode) {
        return `${bankAccount.accountNumber} (${bankAccount.accountName || 'Bank Account'})`;
      }
      // Handle USD format (bankName)
      if (bankAccount.bankName) {
        return `${bankAccount.accountNumber} (${bankAccount.bankName})`;
      }
      // Fallback
      return `${bankAccount.accountNumber} (${bankAccount.accountName || 'Bank Account'})`;
    }
    
    return 'Bank Account';
  }

  /**
   * Mask email for display
   * @param {string} email - Email address
   * @returns {string} Masked email
   */
  maskEmail(email) {
    const [username, domain] = email.split('@');
    const maskedUsername = username.length > 2 
      ? username.substring(0, 2) + '*'.repeat(username.length - 2)
      : username;
    return `${maskedUsername}@${domain}`;
  }

  /**
   * Start cleanup interval for expired data
   */
  startCleanupInterval() {
    // Clean up expired data every 5 minutes
    setInterval(() => {
      this.cleanupExpiredData();
    }, 5 * 60 * 1000);

    // Initial cleanup after 1 minute
    setTimeout(() => {
      this.cleanupExpiredData();
    }, 60 * 1000);
  }

  /**
   * Clean up expired withdrawals and OTPs
   */
  async cleanupExpiredData() {
    try {
      const now = new Date();

      // Mark expired OTPs as expired
      const expiredCount = await WithdrawalOTP.update(
        { status: 'expired' },
        {
          where: {
            status: 'pending',
            expiresAt: {
              [Op.lt]: now
            }
          }
        }
      );

      if (expiredCount[0] > 0) {
        console.log(`[Withdrawal 2FA] Cleanup completed - Expired OTPs: ${expiredCount[0]}`);
      }
    } catch (error) {
      console.error('[Withdrawal 2FA] Cleanup error:', error);
    }
  }

  /**
   * Get service statistics
   * @returns {Promise<Object>} Service statistics
   */
  async getStatistics() {
    try {
      const stats = await WithdrawalOTP.findAll({
        attributes: [
          'status',
          [WithdrawalOTP.sequelize.fn('COUNT', '*'), 'count']
        ],
        group: ['status'],
        raw: true
      });

      const statusCounts = {};
      stats.forEach(stat => {
        statusCounts[stat.status] = parseInt(stat.count);
      });

      return {
        pendingWithdrawals: statusCounts.pending || 0,
        verifiedWithdrawals: statusCounts.verified || 0,
        expiredWithdrawals: statusCounts.expired || 0,
        failedWithdrawals: statusCounts.failed || 0,
        config: this.config
      };
    } catch (error) {
      console.error('[Withdrawal 2FA] Statistics error:', error);
      return {
        pendingWithdrawals: 0,
        verifiedWithdrawals: 0,
        expiredWithdrawals: 0,
        failedWithdrawals: 0,
        config: this.config
      };
    }
  }

  /**
   * Get debug information for troubleshooting
   * @param {number} userId - User ID to filter by (optional)
   * @returns {Promise<Object>} Debug information
   */
  async getDebugInfo(userId = null) {
    try {
      const whereClause = userId ? { userId } : {};
      
      const allRecords = await WithdrawalOTP.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
        limit: 50 // Limit to recent records
      });

      const now = new Date();
      
      const debugData = allRecords.map(record => ({
        withdrawalId: record.withdrawalId,
        userId: record.userId,
        code: record.code,
        amount: record.amount,
        currency: record.currency,
        status: record.status,
        attempts: record.attempts,
        maxAttempts: record.maxAttempts,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        verifiedAt: record.verifiedAt?.toISOString() || null,
        lastResendAt: record.lastResendAt?.toISOString() || null,
        isExpired: now > record.expiresAt
      }));

      const activeRecords = debugData.filter(r => r.status === 'pending' && !r.isExpired);
      
      return {
        totalRecords: debugData.length,
        activeRecords: activeRecords.length,
        records: debugData,
        serverTime: now.toISOString()
      };
    } catch (error) {
      console.error('[Withdrawal 2FA] Debug info error:', error);
      return {
        totalRecords: 0,
        activeRecords: 0,
        records: [],
        error: error.message,
        serverTime: new Date().toISOString()
      };
    }
  }
}

module.exports = Withdrawal2FAService;