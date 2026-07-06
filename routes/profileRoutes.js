const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const authMiddleware = require('../middleware/authMiddleware');
const { upload } = require('../utils/multerConfig');

/**
 * Profile Routes
 * All routes require authentication
 */

// Get user profile
router.get('/', authMiddleware, profileController.getProfile);

// Update user profile
router.patch('/', authMiddleware, profileController.updateProfile);

// Update profile picture
router.post('/picture', authMiddleware, upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]), profileController.updateProfilePicture);

// Change password
router.post('/change-password', authMiddleware, profileController.changePassword);

// Get notification preferences
router.get('/notifications', authMiddleware, profileController.getNotificationPreferences);

// Update notification preferences
router.patch('/notifications', authMiddleware, profileController.updateNotificationPreferences);

module.exports = router;
