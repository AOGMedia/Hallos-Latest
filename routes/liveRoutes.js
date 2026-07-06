const express = require('express');
const router = express.Router();
const liveController = require('../controllers/liveController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkContentAccess } = require('../middleware/purchaseMiddleware');
const { upload } = require('../utils/multerConfig');

// Get all live classes (public endpoint with optional filters)
router.get('/getLive', liveController.getAllLiveClasses);

// Get user's own live classes (authenticated)
router.get('/my-classes', authMiddleware, liveController.getMyLiveClasses);

router.post('/create', authMiddleware, upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'thumbnailUrl', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]), liveController.createLiveClass);
router.post('/:id/add-host', authMiddleware, liveController.addHost);
router.post('/:id/add-attendee', authMiddleware, liveController.addAttendee);
router.post('/:id/register', authMiddleware, liveController.registerForLiveClass);
router.delete('/:id/register', authMiddleware, liveController.cancelLiveClassRegistration);
router.get('/:id/registrations', authMiddleware, liveController.getLiveClassRegistrations);
router.get('/:id', liveController.getLiveClassById);  // ✅ Removed checkContentAccess - now handles access internally
router.get('/:id/playback', checkContentAccess, liveController.getPlayback);
router.get('/:id/hosts', authMiddleware, liveController.getHosts);
router.get('/:id/attendees', authMiddleware, liveController.getAttendees);

// ZegoCloud specific routes
router.post('/:id/start-zegocloud', authMiddleware, liveController.startZegoCloudSession);
router.post('/:id/end-zegocloud', authMiddleware, liveController.endZegoCloudSession);
router.delete('/:id', authMiddleware, liveController.deleteLiveClass);
router.patch('/:id/community', authMiddleware, liveController.linkLiveClassToCommunity);

module.exports = router;