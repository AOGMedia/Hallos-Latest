const express = require('express');
const router = express.Router();
const {
  requestPasswordReset,
  verifyResetOTP,
  resetPassword,
  resendResetOTP
} = require('../controllers/passwordResetController');

/**
 * Password Reset Routes
 * All routes are public (no authentication required)
 */

/**
 * @route   POST /auth/forgot-password
 * @desc    Request password reset - sends OTP to email
 * @access  Public
 * @body    { email }
 */
router.post('/forgot-password', requestPasswordReset);

/**
 * @route   POST /auth/verify-reset-otp
 * @desc    Verify OTP code and get reset token
 * @access  Public
 * @body    { email, otp }
 */
router.post('/verify-reset-otp', verifyResetOTP);

/**
 * @route   POST /auth/reset-password
 * @desc    Reset password with verified token
 * @access  Public
 * @body    { resetToken, newPassword, confirmPassword }
 */
router.post('/reset-password', resetPassword);

/**
 * @route   POST /auth/resend-reset-otp
 * @desc    Resend OTP code (rate limited)
 * @access  Public
 * @body    { email }
 */
router.post('/resend-reset-otp', resendResetOTP);

module.exports = router;