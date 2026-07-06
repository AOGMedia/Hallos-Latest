const express = require('express');
const passport = require('passport');
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { signup, login, getMe } = require('../controllers/authController');
const rateLimiter = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/authMiddleware');
const { googleStrategy } = require('../services/oauthService');

const router = express.Router();

// Initialize Passport Google Strategy
passport.use(googleStrategy);

// Local Signup Route
router.post('/signup', [
  body('firstname').not().isEmpty().withMessage('First name is required'),
  body('lastname').not().isEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Invalid email address'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords must match')
], signup);

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