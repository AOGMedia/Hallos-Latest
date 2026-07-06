const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const SECRET_KEY = process.env.JWT_SECRET_KEY;

exports.signup = async (req, res) => {
  const { firstname, lastname, email, password, confirmPassword } = req.body;
  
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const userExists = await User.findOne({ where: { email } });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords must match' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ firstname, lastname, email, password: hashedPassword });

    // Fire-and-forget referral linking (never blocks signup)
    const refCode = req.body.ref || req.query.ref;
    if (refCode) {
      const referralService = require('../services/referralService');
      referralService.linkCreatorAtSignup(newUser.id, refCode).catch(err => {
        console.error('[Auth] Referral linking failed (non-critical):', err.message);
      });
    }

    const token = jwt.sign({ id: newUser.id, role: newUser.role }, SECRET_KEY, { expiresIn: '1d' });

    res.status(201).json({ message: 'User created successfully', token });
  } catch (error) {
    console.error('[Auth] Signup error:', error);
    res.status(500).json({ message: 'Server error' });
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

    const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '1d' });
    
    // Return user object with role for frontend redirect logic
    res.json({ 
      message: 'Logged in successfully', 
      token,
      user: {
        id: user.id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        role: user.role
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
      attributes: ['id', 'firstname', 'lastname', 'email', 'role', 'createdAt', 'updatedAt']
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
