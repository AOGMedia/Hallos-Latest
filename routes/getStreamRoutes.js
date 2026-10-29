const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const getStreamController = require('../controllers/getStreamController');
const roomExtras = require('../controllers/getStreamRoomExtrasController');
const { giftRateLimit, photoRateLimit, parseChatPhoto } = require('../middleware/getStreamRoomLimits');

/**
 * GetStream live class routes, mounted at /live next to liveRoutes.
 * Every path is GetStream-specific, so none overlap the ZegoCloud routes.
 */
router.post('/:id/start-getstream', authMiddleware, getStreamController.startSession);
router.post('/:id/join-getstream', authMiddleware, getStreamController.joinSession);
router.post('/:id/end-getstream', authMiddleware, getStreamController.endSession);
router.post('/:id/heartbeat-getstream', authMiddleware, getStreamController.heartbeat);
router.post('/:id/recording-getstream', authMiddleware, getStreamController.setRecording);
router.get('/:id/recordings-getstream', authMiddleware, getStreamController.listRecordings);

// In-room extras: gifts to the host and photos in chat.
router.get('/:id/gifts-getstream', authMiddleware, roomExtras.giftOverview('class'));
router.post('/:id/gift-getstream', authMiddleware, giftRateLimit, roomExtras.sendGift('class'));
router.post('/:id/chat-photo-getstream', authMiddleware, photoRateLimit, parseChatPhoto, roomExtras.shareChatPhoto('class'));

module.exports = router;
