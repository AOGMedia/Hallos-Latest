'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/notificationPreferencesController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/requirePermission');

// User preferences
router.get('/preferences', authMiddleware, ctrl.getPreferences);
router.patch('/preferences', authMiddleware, ctrl.updatePreferences);

// Admin endpoints
router.get('/digest-queue', authMiddleware, requirePermission('notifications.view'), ctrl.getDigestQueue);
router.get('/logs', authMiddleware, requirePermission('notifications.view'), ctrl.getNotificationLogs);
router.post('/digest/trigger', authMiddleware, requirePermission('notifications.manage'), ctrl.triggerDigest);

module.exports = router;
