const express = require('express');
const router = express.Router();
const sessionRecordingController = require('../controllers/sessionRecordingController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/requirePermission');

/**
 * Session Recording Routes
 * All routes require admin authentication
 */

/**
 * Send test recording email
 * POST /api/admin/live-series/:seriesId/send-recording/test
 * 
 * Body: {
 *   recordings: [{ sessionNumber: 1, driveLink: "..." }],
 *   customMessage: "Optional message",
 *   testEmail: "test@example.com"
 * }
 */
/**
 * Find a series by title (any status or privacy)
 * GET /api/admin/live-series/search?q=
 */
router.get(
  '/search',
  authMiddleware,
  requirePermission('recordings.view'),
  sessionRecordingController.searchSeries
);

router.post(
  '/:seriesId/send-recording/test',
  authMiddleware,
  requirePermission('recordings.send'),
  sessionRecordingController.sendTestRecordingEmail
);

/**
 * Send recordings to all enrolled students
 * POST /api/admin/live-series/:seriesId/send-recording
 * 
 * Body: {
 *   recordings: [
 *     { sessionNumber: 1, driveLink: "..." },
 *     { sessionNumber: 2, driveLink: "..." }
 *   ],
 *   customMessage: "Optional message"
 * }
 */
router.post(
  '/:seriesId/send-recording',
  authMiddleware,
  requirePermission('recordings.send'),
  sessionRecordingController.sendRecordingToStudents
);

/**
 * Get recording send history for a series
 * GET /api/admin/live-series/:seriesId/recording-history
 */
router.get(
  '/:seriesId/recording-history',
  authMiddleware,
  requirePermission('recordings.view'),
  sessionRecordingController.getRecordingHistory
);

module.exports = router;
