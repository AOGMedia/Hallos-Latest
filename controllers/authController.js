const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { avatarUrlOf } = require('../utils/userAvatar');
const { recordLogin } = require('../services/userLoginService');
const signupVerification = require('../services/signupVerificationService');
const { SignupError } = signupVerification;
const SECRET_KEY = process.env.JWT_SECRET_KEY;

const sendSignupError = (res, error, fallback) => {
  if (error instanceof SignupError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code, ...error.details });
  }
  console.error(`[Auth] ${fallback}:`, error);
  return res.status(500).json({ success: false, message: 'Server error' });
};

/** After the account is created: referral link, quiz invite, login token. */
const finishSignup = (req, user, { referralCode, quizInviteToken }) => {
  // Fire-and-forget referral linking (never blocks signup)
  if (referralCode) {
    const referralService = require('../services/referralService');
    referralService.linkCreatorAtSignup(user.id, referralCode).catch(err => {
      console.error('[Auth] Referral linking failed (non-critical):', err.message);
    });
  }

  // Fire-and-forget quiz invite claim (never blocks signup). This is a
  // belt-and-suspenders convenience — the frontend should also call
  // POST /api/quiz/invite/claim explicitly once it has a session, since
  // that path also covers login and OAuth, which this hook doesn't.
  if (quizInviteToken) {
    const quizInviteService = require('../services/quizInviteService');
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    quizInviteService.claimInvite({ token: quizInviteToken, inviteeUserId: user.id, ip }).catch(err => {
      console.error('[Auth] Quiz invite claim failed (non-critical):', err.message);
    });
  }

  return jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '1d' });
};

/**
 * The old one-step sign-up. Signing up now needs the email verified first
 * (POST /auth/signup/start, then /auth/signup/verify), so an out-of-date page
 * or app version gets a clear message instead of an unverified account.
 */
exports.signup = (req, res) => {
  res.status(400).json({
    success: false,
    code: 'EMAIL_VERIFICATION_REQUIRED',
    message: 'Signing up now needs a quick email check. Please refresh the page, or update the app, and try again.'
  });
};

/**
 * Sign-up step 1: check the details and email a 6-digit code.
 * POST /auth/signup/start
 */
exports.signupStart = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { firstname, lastname, email, password, confirmPassword } = req.body;
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords must match' });
  }

  try {
    const result = await signupVerification.startSignup({
      firstname,
      lastname,
      email,
      password,
      referralCode: req.body.ref || req.query.ref,
      quizInviteToken: req.body.quizInviteToken || req.query.quizInviteToken
    });
    res.status(200).json({ success: true, verificationRequired: true, message: 'We sent a code to your email.', ...result });
  } catch (error) {
    sendSignupError(res, error, 'Signup start error');
  }
};

/**
 * Send a new sign-up code.
 * POST /auth/signup/resend  { email }
 */
exports.signupResend = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const result = await signupVerification.resendCode({ email: req.body.email });
    res.status(200).json({ success: true, message: 'We sent you a new code.', ...result });
  } catch (error) {
    sendSignupError(res, error, 'Signup resend error');
  }
};

/**
 * Sign-up step 2: the right code creates the account and logs them in.
 * Same response as sign-up has always given.
 * POST /auth/signup/verify  { email, code }
 */
exports.signupVerify = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { user, referralCode, quizInviteToken } = await signupVerification.verifySignup({
      email: req.body.email,
      code: req.body.code
    });
    const token = finishSignup(req, user, { referralCode, quizInviteToken });
    res.status(201).json({ message: 'User created successfully', token });
  } catch (error) {
    sendSignupError(res, error, 'Signup verify error');
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Fire-and-forget quiz invite claim (never blocks login) — covers the
    // "friend already had an account, just wasn't online" case.
    const quizInviteToken = req.body.quizInviteToken || req.query.quizInviteToken;
    if (quizInviteToken) {
      const quizInviteService = require('../services/quizInviteService');
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
      quizInviteService.claimInvite({ token: quizInviteToken, inviteeUserId: user.id, ip }).catch(err => {
        console.error('[Auth] Quiz invite claim failed (non-critical):', err.message);
      });
    }

    const suspension = require('../services/suspensionService');
    if (suspension.isSuspended(user.id)) return res.status(403).json(suspension.suspendedResponse(user.id));
    const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '1d' });
    recordLogin(user.id, req, 'password');

    // Return user object with role for frontend redirect logic
    res.json({ 
      message: 'Logged in successfully', 
      token,
      user: {
        id: user.id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        role: user.role,
        avatarUrl: avatarUrlOf(user)
      }
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getMe = async (req, res) => {
  try {
    // Get user ID from the authenticated request (set by authMiddleware)
    const userId = req.user.id;

    // Fetch user details from database
    const user = await User.findByPk(userId, {
      attributes: ['id', 'firstname', 'lastname', 'email', 'role', 'socialLinks', 'createdAt', 'updatedAt']
    });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role,
        // provider: user.provider || 'local',
        fullName: `${user.firstname} ${user.lastname}`.trim(),
        avatarUrl: avatarUrlOf(user),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch user profile' 
    });
  }
};
