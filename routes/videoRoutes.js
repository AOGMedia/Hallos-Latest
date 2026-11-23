const express = require('express');
const { uploadVideo,
    getAllVideos,
  getVideoById,
  getUserVideos,
  getMyVideos,
  deleteVideo,
  linkVideoToCommunity
 } = require('../controllers/videoController');
const { upload } = require('../utils/multerConfig');
const authMiddleware = require('../middleware/authMiddleware');
const { checkContentAccess } = require('../middleware/purchaseMiddleware');
const videoDrafts = require('../controllers/videoDraftController');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const router = express.Router();

router.post(
  '/upload',
  authMiddleware,
  upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'thumbnailUrl', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 }
  ]),
  uploadVideo
);

// Uploads that start as soon as the file is picked (drafts until Publish).
// The classic POST /upload above keeps working unchanged.
const draftLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip || '127.0.0.1')),
  message: { success: false, message: 'Too many uploads started. Please wait a little and try again.' }
});
router.post('/drafts', authMiddleware, draftLimit, videoDrafts.create);
router.post('/drafts/:id/restart', authMiddleware, draftLimit, videoDrafts.restart);
router.put(
  '/drafts/:id/publish',
  authMiddleware,
  upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'image', maxCount: 1 }
  ]),
  videoDrafts.publish
);
router.delete('/drafts/:id', authMiddleware, videoDrafts.discard);

router.get('/', getAllVideos);             // public feed
router.get('/my-videos', authMiddleware, getMyVideos); // current user's videos
router.get('/user/:userId', authMiddleware, getUserVideos); // creator dashboard
router.get('/:id', checkContentAccess, getVideoById);          // single video + metadata (with access control)
router.delete('/:id', authMiddleware, deleteVideo);
router.patch('/:id/community', authMiddleware, linkVideoToCommunity);             // delete video

module.exports = router;