'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/notificationPreferencesController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// User preferences
router.get('/preferences', authMiddleware, ctrl.getPreferences);
router.patch('/preferences', authMiddleware, ctrl.updatePreferences);

// Admin endpoints
router.get('/digest-queue', authMiddleware, adminMiddleware, ctrl.getDigestQueue);
router.get('/logs', authMiddleware, adminMiddleware, ctrl.getNotificationLogs);
router.post('/digest/trigger', authMiddleware, adminMiddleware, ctrl.triggerDigest);

module.exports = router;
