const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const announcements = require('../services/announcementService');

const router = express.Router();

/**
 * GET /api/announcements/active?platform=web|app
 * Banners for the signed-in person. Never fails the page: on any problem it
 * answers with an empty list.
 */
router.get('/active', authMiddleware, (req, res) => {
  try {
    const platform = req.query.platform === 'app' ? 'app' : 'web';
    return res.json({ success: true, data: announcements.activeFor({ platform, role: req.user?.role }) });
  } catch (error) {
    console.error('[Announcements] Active list failed:', error.message);
    return res.json({ success: true, data: [] });
  }
});

module.exports = router;
