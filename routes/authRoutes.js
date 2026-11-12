const express = require('express');
const { recordLogin } = require('../services/userLoginService');
const passport = require('passport');
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { signup, signupStart, signupResend, signupVerify, login, getMe } = require('../controllers/authController');
const rateLimiter = require('../middleware/rateLimiter');
const { signupCodeLimiter, signupVerifyLimiter } = require('../middleware/signupLimits');
const authMiddleware = require('../middleware/authMiddleware');
const { googleStrategy } = require('../services/oauthService');

const router = express.Router();

// Initialize Passport Google Strategy
passport.use(googleStrategy);

// Old one-step sign-up: now answers "please refresh / update" (email must be verified first).
router.post('/signup', signup);

// Email-verified sign-up: details + emailed code, then the code creates the account.
router.post('/signup/start', signupCodeLimiter, [
  body('firstname').trim().not().isEmpty().withMessage('First name is required'),
  body('lastname').trim().not().isEmpty().withMessage('Last name is required'),
  body('email').trim().isEmail().withMessage('Invalid email address'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords must match')
], signupStart);
router.post('/signup/resend', signupCodeLimiter, [
  body('email').trim().isEmail().withMessage('Invalid email address')
], signupResend);
router.post('/signup/verify', signupVerifyLimiter, [
  body('email').trim().isEmail().withMessage('Invalid email address'),
  body('code').not().isEmpty().withMessage('Enter the code from your email')
], signupVerify);

// Local Login Route
router.post('/login', [
  body('email').isEmail().withMessage('Invalid email address'),
  body('password').not().isEmpty().withMessage('Password is required')
], login);

// Get Current User Profile
router.get('/me', authMiddleware, getMe);

// Google OAuth Routes
router.get('/google', passport.authenticate('google', { scope: ['email', 'profile'] }));

router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    recordLogin(req.user.id, req, 'google');
    const token = jwt.sign(
      { id: req.user.id, role: req.user.role },
      process.env.JWT_SECRET_KEY,
      { expiresIn: '7d' }
    );

    // Set the token as a cookie (not httpOnly since frontend needs access; secure for HTTPS; lax for most flows)
    res.cookie('token', token, { httpOnly: false, secure: true, sameSite: 'lax' });
    res.redirect(`https://www.hallos.net/auth/callback?token=${token}`);
  }
);

module.exports = router