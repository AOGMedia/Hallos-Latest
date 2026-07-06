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

router.get('/', getAllVideos);             // public feed
router.get('/my-videos', authMiddleware, getMyVideos); // current user's videos
router.get('/user/:userId', authMiddleware, getUserVideos); // creator dashboard
router.get('/:id', checkContentAccess, getVideoById);          // single video + metadata (with access control)
router.delete('/:id', authMiddleware, deleteVideo);
router.patch('/:id/community', authMiddleware, linkVideoToCommunity);             // delete video

module.exports = router;