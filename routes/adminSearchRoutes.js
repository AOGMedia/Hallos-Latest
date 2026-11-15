const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/authMiddleware');
const { getStaffAccess } = require('../services/staffAccessService');
const { search } = require('../services/adminSearchService');

/**
 * GET /api/admin/search?q=term
 * The admin's one search box. Open to super admins and to any staff member;
 * each group in the results is filtered by that person's permissions.
 * (Passed through the admin router as a delegated path; see staffRouteAccess.)
 */
const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // typing fires a request per pause; this only stops runaway clients
  keyGenerator: (req) => `admin-search:${req.user?.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many searches. Wait a moment and try again.' },
});

router.get('/', authMiddleware, searchLimiter, async (req, res) => {
  try {
    let access = { isSuperAdmin: req.user.role === 'admin', permissions: [] };
    if (!access.isSuperAdmin) {
      const staff = await getStaffAccess(req.user.id);
      access = { isSuperAdmin: false, permissions: staff?.permissions || [] };
      if (access.permissions.length === 0) {
        return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
      }
    }
    return res.json({ success: true, data: await search(req.query.q, access) });
  } catch (error) {
    console.error('[Admin search] Request failed:', error);
    return res.status(500).json({ success: false, message: 'Search failed. Please try again.' });
  }
});

module.exports = router;
