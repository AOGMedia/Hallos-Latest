const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/authMiddleware');
const controller = require('../controllers/adminContentController');

const router = express.Router();

// Generous for real use, tight enough to stop report flooding.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You’ve sent a lot of reports. Please try again later.' },
  keyGenerator: (req) => `user:${req.user.id}`,
});

/** POST /api/reports  { targetType, targetId, reason, details? } */
router.post('/', authMiddleware, reportLimiter, controller.createReport);

module.exports = router;
