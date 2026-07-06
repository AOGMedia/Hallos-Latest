const express = require('express');
const router = express.Router();
const adminCouponController = require('../controllers/adminCouponController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// All routes require authentication and admin privileges
router.use(authMiddleware);
router.use(adminMiddleware);

// Create coupon (admin can create partner or creator coupons)
router.post('/create', adminCouponController.adminCreate);

// Get all coupons with filtering
router.get('/', adminCouponController.getAllCoupons);

// Get aggregate analytics (must be before /:id routes to avoid conflict)
router.get('/analytics', adminCouponController.getAnalytics);

// Update coupon
router.put('/:id', adminCouponController.adminUpdate);

// Delete (deactivate) coupon
router.delete('/:id', adminCouponController.adminDelete);

// Get coupon usage history with pagination
router.get('/:id/usage-history', adminCouponController.getUsageHistory);

module.exports = router;
