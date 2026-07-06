const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middleware/authMiddleware');

// Rate limiters for coupon operations
const validateRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { success: false, message: 'Too many coupon validation attempts, please try again later.' }
});

const createRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 requests per hour
  message: { success: false, message: 'Too many coupon creation attempts, please try again later.' }
});

// Validate coupon
router.post('/validate', authMiddleware, validateRateLimiter, couponController.validate);

// Create coupon (creator only)
router.post('/create', authMiddleware, createRateLimiter, couponController.create);

// Get creator's coupons
router.get('/my-coupons', authMiddleware, couponController.getMyCoupons);

// Update coupon
router.put('/:id', authMiddleware, couponController.update);

// Delete (deactivate) coupon
router.delete('/:id', authMiddleware, couponController.delete);

// Get coupon usage statistics
router.get('/:id/usage', authMiddleware, couponController.getUsage);

module.exports = router;
