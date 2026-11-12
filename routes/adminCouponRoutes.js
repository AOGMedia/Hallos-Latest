const express = require('express');
const router = express.Router();
const adminCouponController = require('../controllers/adminCouponController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/requirePermission');
const { COUPON_ROUTE_PERMISSIONS } = require('../config/staffRouteAccess');

// All routes require authentication and admin privileges
router.use(authMiddleware);
router.use(requirePermission.byRoute(COUPON_ROUTE_PERMISSIONS));

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

// Delete for good. Only for coupons that were never used, so sales records stay intact.
router.delete('/:id/permanent', adminCouponController.adminHardDelete);

// Get coupon usage history with pagination
router.get('/:id/usage-history', adminCouponController.getUsageHistory);

module.exports = router;
