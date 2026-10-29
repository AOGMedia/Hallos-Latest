const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const getStreamSessionController = require('../controllers/getStreamSessionController');
const roomExtras = require('../controllers/getStreamRoomExtrasController');
const { giftRateLimit, photoRateLimit, parseChatPhoto } = require('../middleware/getStreamRoomLimits');

/**
 * GetStream routes for live series sessions, mounted at /api/live/series next
 * to routes/liveSeries.js. Every path is GetStream-specific, so none overlap
 * the ZegoCloud session routes (/session/:id/start, /join, /end).
 */
router.post('/session/:id/start-getstream', authMiddleware, getStreamSessionController.startSession);
router.post('/session/:id/join-getstream', authMiddleware, getStreamSessionController.joinSession);
router.post('/session/:id/end-getstream', authMiddleware, getStreamSessionController.endSession);
router.post('/session/:id/recording-getstream', authMiddleware, getStreamSessionController.setRecording);
router.get('/session/:id/recordings-getstream', authMiddleware, getStreamSessionController.listRecordings);

// In-room extras: gifts to the host and photos in chat.
router.get('/session/:id/gifts-getstream', authMiddleware, roomExtras.giftOverview('session'));
router.post('/session/:id/gift-getstream', authMiddleware, giftRateLimit, roomExtras.sendGift('session'));
router.post(
  '/session/:id/chat-photo-getstream',
  authMiddleware,
  photoRateLimit,
  parseChatPhoto,
  roomExtras.shareChatPhoto('session')
);

module.exports = router;
