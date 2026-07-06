const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const { sendPasswordResetOTP } = require('../utils/email');

// In-memory store for OTPs (in production, use Redis or database)
const otpStore = new Map();

/**
 * Generate 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Request password reset - sends OTP to email
 * POST /auth/forgot-password
 */
const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Check if user exists
    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) {
      // Don't reveal if email exists or not for security
      return res.status(200).json({
        success: true,
        message: 'If an account with this email exists, you will receive a password reset code.'
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP (in production, use Redis with TTL)
    otpStore.set(email.toLowerCase(), {
      otp,
      expiry: otpExpiry,
      attempts: 0,
      userId: user.id
    });

    // Send OTP email
    await sendPasswordResetOTP(email, user.firstname, otp);

    res.status(200).json({
      success: true,
      message: 'Password reset code sent to your email. Check your inbox and spam folder.',
      expiresIn: '10 minutes'
    });

  } catch (error) {
    console.error('Request password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send password reset code. Please try again.'
    });
  }
};

/**
 * Verify OTP code
 * POST /auth/verify-reset-otp
 */
const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP code are required'
      });
    }

    // Get stored OTP
    const storedData = otpStore.get(email.toLowerCase());
    if (!storedData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code'
      });
    }

    // Check expiry
    if (Date.now() > storedData.expiry) {
      otpStore.delete(email.toLowerCase());
      return res.status(400).json({
        success: false,
        message: 'OTP code has expired. Please request a new one.'
      });
    }

    // Check attempts (prevent brute force)
    if (storedData.attempts >= 5) {
      otpStore.delete(email.toLowerCase());
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP code.'
      });
    }

    // Verify OTP
    if (storedData.otp !== otp.toString()) {
      storedData.attempts += 1;
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code',
        attemptsRemaining: 5 - storedData.attempts
      });
    }

    // Generate reset token (valid for 15 minutes)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store reset token
    otpStore.set(`reset_${resetToken}`, {
      userId: storedData.userId,
      email: email.toLowerCase(),
      expiry: resetTokenExpiry
    });

    // Remove OTP from store
    otpStore.delete(email.toLowerCase());

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      resetToken,
      expiresIn: '15 minutes'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP code. Please try again.'
    });
  }
};

/**
 * Reset password with verified token
 * POST /auth/reset-password
 */
const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    // Validate input
    if (!resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Reset token, new password, and confirmation are required'
      });
    }

    // Check password match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    // Validate password strength
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Get reset token data
    const tokenData = otpStore.get(`reset_${resetToken}`);
    if (!tokenData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Check token expiry
    if (Date.now() > tokenData.expiry) {
      otpStore.delete(`reset_${resetToken}`);
      return res.status(400).json({
        success: false,
        message: 'Reset token has expired. Please start the process again.'
      });
    }

    // Get user
    const user = await User.findByPk(tokenData.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user password
    await user.update({
      password: hashedPassword,
      updatedAt: new Date()
    });

    // Remove reset token
    otpStore.delete(`reset_${resetToken}`);

    console.log(`Password reset successful for user: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password. Please try again.'
    });
  }
};

/**
 * Resend OTP (rate limited)
 * POST /auth/resend-reset-otp
 */
const resendResetOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Check if there's an existing OTP request
    const existingData = otpStore.get(email.toLowerCase());
    if (existingData) {
      // Rate limiting: allow resend only after 2 minutes
      const timeSinceLastRequest = Date.now() - (existingData.expiry - 10 * 60 * 1000);
      if (timeSinceLastRequest < 2 * 60 * 1000) {
        const waitTime = Math.ceil((2 * 60 * 1000 - timeSinceLastRequest) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitTime} seconds before requesting a new code`
        });
      }
    }

    // Proceed with normal OTP request
    await requestPasswordReset(req, res);

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP code. Please try again.'
    });
  }
};

module.exports = {
  requestPasswordReset,
  verifyResetOTP,
  resetPassword,
  resendResetOTP
};