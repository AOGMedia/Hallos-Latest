const express = require('express');
const rateLimit = require('express-rate-limit');
const classFeedback = require('../controllers/classFeedbackController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/** Generous for real people, tight enough to stop anyone hammering the form. */
const feedbackLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many tries. Please wait a moment and try again.' }
});

// The signed-in person's own link, for the class-ended screen (before /:token).
router.post('/link', feedbackLimit, authMiddleware, classFeedback.link);

// Creators: what people said about their classes (before /:token).
router.get('/mine', authMiddleware, classFeedback.mine);
router.get('/mine/:kind/:id', authMiddleware, classFeedback.mineDetail);

// Feedback after live classes and series sessions. Access is the personal
// link's signed token (see services/classFeedbackService.js).
router.get('/:token', feedbackLimit, classFeedback.getForm);
router.post('/:token', feedbackLimit, classFeedback.submit);

module.exports = router;
