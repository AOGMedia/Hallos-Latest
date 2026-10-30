const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const controller = require('../controllers/emailCampaignController');
const authMiddleware = require('../middleware/authMiddleware');
const emailPortalMiddleware = require('../middleware/emailPortalMiddleware');

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait a moment.' },
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip || '127.0.0.1'))
});

// Public: recipients follow this link from the email footer / List-Unsubscribe header
router.get('/unsubscribe', controller.unsubscribeConfirm);
router.post('/unsubscribe', controller.unsubscribe);

// Everything below needs a logged-in user with the email_marketer (or admin) role
router.use(authMiddleware);
router.use(emailPortalMiddleware);

router.get('/me', controller.me);
router.get('/stats', controller.stats);

router.get('/audience/options', controller.audienceOptions);
router.post('/audience/preview', controller.audiencePreview);
router.post('/audience/users', controller.audienceUsers);

router.post('/test', sendLimiter, controller.sendTest);

router.get('/campaigns', controller.listCampaigns);
router.post('/campaigns', controller.createCampaign);
router.get('/campaigns/:id', controller.getCampaign);
router.put('/campaigns/:id', controller.updateCampaign);
router.delete('/campaigns/:id', controller.deleteCampaign);
router.post('/campaigns/:id/send', sendLimiter, controller.sendCampaign);
router.post('/campaigns/:id/cancel', controller.cancelCampaign);
router.post('/campaigns/:id/retry-failed', controller.retryFailed);
router.get('/campaigns/:id/recipients', controller.listRecipients);
router.get('/campaigns/:id/export', controller.exportRecipients);

module.exports = router;
