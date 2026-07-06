const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');
const { payments } = require('../middleware/financialRateLimiter');
const fraudDetectionMiddleware = require('../middleware/fraudDetectionMiddleware');

// Get payment configuration (supported currencies and gateways)
router.get('/config', paymentController.getPaymentConfig);

// Initialize payment checkout (with rate limiting and fraud detection)
router.post('/initialize', authMiddleware, payments, fraudDetectionMiddleware.payments, paymentController.initializeCheckout);

// Verify payment (GET and POST, no auth required since reference is unique)
router.get('/verify/:reference', paymentController.verifyPayment);
router.post('/verify/:reference', paymentController.verifyPayment);

// Get student's purchase history
router.get('/my-purchases', authMiddleware, paymentController.getMyPurchases);

// Check if user owns content
router.get('/check-access', authMiddleware, paymentController.checkOwnership);

module.exports = router;