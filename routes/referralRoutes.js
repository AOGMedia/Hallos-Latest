const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const referralAdminController = require('../controllers/referralAdminController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// ==================== PARTNER ROUTES ====================

// GET /api/referral/my-code
router.get('/my-code', authMiddleware, referralController.getMyCode);

// GET /api/referral/my-stats
router.get('/my-stats', authMiddleware, referralController.getMyStats);

// ==================== ADMIN ROUTES ====================

// POST /api/referral/admin/codes
router.post('/admin/codes', authMiddleware, adminMiddleware, referralAdminController.createCode);

// PUT /api/referral/admin/codes/:id
router.put('/admin/codes/:id', authMiddleware, adminMiddleware, referralAdminController.updateCode);

// GET /api/referral/admin/codes
router.get('/admin/codes', authMiddleware, adminMiddleware, referralAdminController.listCodes);

// GET /api/referral/admin/codes/:id/creators
router.get('/admin/codes/:id/creators', authMiddleware, adminMiddleware, referralAdminController.getCreators);

// GET /api/referral/admin/commissions
router.get('/admin/commissions', authMiddleware, adminMiddleware, referralAdminController.getCommissions);

module.exports = router;
