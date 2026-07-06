const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const campaignQuizController = require('../controllers/campaignQuizController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// ── REGISTRATION ──────────────────────────────────────────────────────────────

// Public — no auth required
router.post('/register', campaignController.registerForCampaign);

// Admin only — list all registrations
router.get('/registrations', authMiddleware, adminMiddleware, campaignController.getRegistrations);

// ── QUIZ — PARTICIPANT (auth required) ────────────────────────────────────────

// Start or resume a quiz session (requires platform login)
router.get('/quiz/:token/start', authMiddleware, campaignQuizController.startSession);

// Submit one answer
router.post('/quiz/:token/answer', authMiddleware, campaignQuizController.submitAnswer);

// Submit / close the quiz
router.post('/quiz/:token/submit', authMiddleware, campaignQuizController.submitQuiz);

// Check current session status (for refresh / re-entry)
router.get('/quiz/:token/status', authMiddleware, campaignQuizController.getSessionStatus);

// ── QUIZ — ADMIN ──────────────────────────────────────────────────────────────

// Leaderboard / all results
router.get('/quiz/admin/results', authMiddleware, adminMiddleware, campaignQuizController.getResults);

// Trigger quiz access emails for all paid registrants without a session
router.post('/quiz/admin/send-links', authMiddleware, adminMiddleware, campaignQuizController.sendQuizLinks);

// Detailed answers for one session
router.get('/quiz/admin/session/:sessionId/answers', authMiddleware, adminMiddleware, campaignQuizController.getSessionAnswers);

module.exports = router;
