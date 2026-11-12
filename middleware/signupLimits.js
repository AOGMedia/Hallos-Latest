const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

/**
 * Per-IP limits for the email-code sign-up endpoints, on top of the general
 * /auth limiter. Codes cost an email each, so sending them is held tighter
 * than checking them. (Each pending sign-up also has its own resend cooldown
 * and attempt limits — see signupVerificationService.)
 */
const byIp = (req) => ipKeyGenerator(req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || '127.0.0.1');

const signupCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byIp,
  message: { success: false, message: 'Too many sign-up attempts. Please try again in a few minutes.' }
});

const signupVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byIp,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' }
});

module.exports = { signupCodeLimiter, signupVerifyLimiter };
