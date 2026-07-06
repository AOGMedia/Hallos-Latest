const express = require('express');
const router = express.Router();
const muxController = require('../controllers/muxController');
const webhookController = require('../controllers/webhookController');
const authMiddleware = require('../middleware/authMiddleware');

// Mux webhook
router.post('/mux', 
    express.raw({ type: "application/json" }),
    muxController.handleMuxWebhook);

// Paystack webhook
router.post('/paystack',
    express.json(),
    webhookController.handlePaystackWebhook);

// Stripe webhook
router.post('/stripe',
    express.raw({ type: "application/json" }),
    webhookController.handleStripeWebhook);

// Webhook security management endpoints (admin only)
router.get('/security/stats', 
    authMiddleware, 
    webhookController.getWebhookSecurityStats);

router.post('/security/block-ip', 
    authMiddleware, 
    webhookController.blockIP);

router.post('/security/unblock-ip', 
    authMiddleware, 
    webhookController.unblockIP);

module.exports = router;