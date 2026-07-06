const PaymentRoutingService = require('../services/paymentRoutingService');
const Purchase = require('../models/Purchase');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');
const User = require('../models/User');
const { Op } = require('sequelize');

// Initialize payment routing service
const paymentRoutingService = new PaymentRoutingService();

/**
 * Initialize payment checkout with automatic currency routing
 * POST /api/payments/initialize
 */
exports.initializeCheckout = async (req, res) => {
  try {
    const { contentType, contentId, currency: forceCurrency, couponCode, referralCode } = req.body;
    const userId = req.user.id;
    const idempotencyKey = req.headers['idempotency-key'];

    // Validate input
    if (!contentType || !contentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: contentType, contentId'
      });
    }

    if (!['video', 'live_class', 'live_series', 'freebie'].includes(contentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content type. Must be "video", "live_class", "live_series", or "freebie"'
      });
    }

    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: 'Idempotency-Key header is required'
      });
    }

    // Get user email
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Initialize payment with automatic routing
    const result = await paymentRoutingService.initializePayment({
      userId,
      contentType,
      contentId,
      userEmail: user.email,
      idempotencyKey,
      forceCurrency,
      couponCode,
      referralCode,
      metadata: req.body.communityId ? { communityId: req.body.communityId } : {}
    });

    return res.status(200).json({
      success: true,
      message: result.cached ? 'Payment already initialized (cached)' : 'Payment initialized successfully',
      currency: result.currency,
      gateway: result.gateway,
      requiredGateway: result.requiredGateway,
      cached: result.cached || false,
      freeAccess: result.freeAccess || false,
      couponApplied: result.couponApplied || false,
      data: result.data,
      purchase: result.purchase
    });
  } catch (error) {
    console.error('Initialize checkout error:', error);
    
    // Handle specific business logic errors with appropriate status codes
    if (error.message.includes('already purchased')) {
      return res.status(409).json({
        success: false,
        message: 'You have already purchased this content',
        alreadyPurchased: true,
        errorCode: 'ALREADY_PURCHASED'
      });
    }
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message,
        errorCode: 'CONTENT_NOT_FOUND'
      });
    }
    
    if (error.message.includes('free') || error.message.includes('No payment required')) {
      return res.status(400).json({
        success: false,
        message: error.message,
        errorCode: 'FREE_CONTENT'
      });
    }
    
    // Default server error
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to initialize payment',
      errorCode: 'PAYMENT_INITIALIZATION_FAILED'
    });
  }
};

/**
 * Verify payment with automatic gateway detection
 * GET/POST /api/payments/verify/:reference
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const { currency } = req.query;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!currency) {
      return res.status(400).json({
        success: false,
        message: 'Currency parameter is required. Use ?currency=NGN or ?currency=USD'
      });
    }

    // ── CAMPAIGN REGISTRATION: reference starts with 'camp_' ──
    if (reference && reference.startsWith('camp_')) {
      console.log(`[Payment Verification] Detected campaign registration reference: ${reference}`);

      const CampaignRegistration = require('../models/CampaignRegistration');
      const { createQuizSession } = require('../services/campaignQuizService');
      const { sendCampaignQuizAccessEmail } = require('../utils/email');
      const { paystackClient } = require('../config/paystack');

      const registration = await CampaignRegistration.findOne({ where: { paymentReference: reference } });

      if (!registration) {
        return res.status(404).json({ success: false, message: 'Campaign registration not found for this reference' });
      }

      if (registration.paymentStatus === 'completed') {
        return res.status(200).json({
          success: true,
          message: 'Payment already confirmed. Welcome to the retreat!',
          alreadyProcessed: true,
          registration: {
            id: registration.id,
            firstName: registration.firstName,
            lastName: registration.lastName,
            email: registration.email,
            paymentStatus: registration.paymentStatus
          }
        });
      }

      const paystackResponse = await paystackClient.get(`/transaction/verify/${reference}`);
      const txData = paystackResponse.data.data;

      if (!paystackResponse.data.status || txData.status !== 'success') {
        await registration.update({ paymentStatus: 'failed' });
        return res.status(400).json({
          success: false,
          message: `Payment not successful. Paystack status: ${txData.status}`
        });
      }

      await registration.update({ paymentStatus: 'completed' });

      if (!registration.emailSent) {
        createQuizSession(registration.id, registration.email)
          .then(({ token }) => sendCampaignQuizAccessEmail(
            registration.email,
            registration.firstName,
            { lastName: registration.lastName, talent: registration.talent, location: registration.location, token }
          ))
          .then(() => registration.update({ emailSent: true }))
          .catch(err => console.error('[Campaign] Quiz access email failed:', err.message));
      }

      console.log(`[Payment Verification] Campaign registration confirmed: ${reference}`);

      return res.status(200).json({
        success: true,
        message: 'Payment confirmed! Check your email for retreat details.',
        registration: {
          id: registration.id,
          firstName: registration.firstName,
          lastName: registration.lastName,
          email: registration.email,
          paymentStatus: 'completed'
        }
      });
    }

    // ── WALLET TOP-UP: reference starts with 'topup_' ──
    if (reference && reference.startsWith('topup_')) {
      console.log(`[Payment Verification] Detected wallet top-up reference: ${reference}`);

      const MultiCurrencyWalletService = require('../services/multiCurrencyWalletService');
      const { paystackClient } = require('../config/paystack');
      const { stripeClient } = require('../config/stripe');
      const sequelize = require('../config/db');
      const walletService = new MultiCurrencyWalletService();

      // Idempotency — check if already credited
      const WalletTransaction = sequelize.models.WalletTransaction;
      if (WalletTransaction) {
        const existing = await WalletTransaction.findOne({ where: { reference } });
        if (existing) {
          return res.status(200).json({
            success: true,
            message: 'Top-up already processed',
            alreadyProcessed: true,
            currency: currency.toUpperCase()
          });
        }
      }

      let amount;
      let userId;
      const currencyUpper = currency.toUpperCase();

      if (currencyUpper === 'NGN') {
        // Verify with Paystack
        const response = await paystackClient.get(`/transaction/verify/${reference}`);
        if (!response.data.status || response.data.data.status !== 'success') {
          return res.status(400).json({ success: false, message: 'Payment not successful' });
        }
        amount = response.data.data.amount / 100;
        userId = parseInt(response.data.data.metadata.userId);
      } else if (currencyUpper === 'USD') {
        // For Stripe top-ups the reference is the session_id passed via query
        const sessionId = req.query.session_id;
        if (!sessionId) {
          return res.status(400).json({ success: false, message: 'session_id is required for USD top-up verification' });
        }
        const session = await stripeClient.checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== 'paid') {
          return res.status(400).json({ success: false, message: `Payment status: ${session.payment_status}` });
        }
        amount = session.amount_total / 100;
        userId = parseInt(session.metadata.userId);
      } else {
        return res.status(400).json({ success: false, message: 'Unsupported currency for top-up' });
      }

      // Credit the wallet
      await walletService.creditWallet({
        userId,
        currency: currencyUpper,
        amount,
        reference,
        description: `Wallet top-up via ${currencyUpper === 'NGN' ? 'Paystack' : 'Stripe'}`,
        metadata: { gateway: currencyUpper === 'NGN' ? 'paystack' : 'stripe', type: 'topup' }
      });

      console.log(`[Payment Verification] Wallet top-up credited: ${amount} ${currencyUpper} to user ${userId}`);

      return res.status(200).json({
        success: true,
        message: `Wallet topped up successfully with ${amount} ${currencyUpper}`,
        currency: currencyUpper,
        amount
      });
    }

    // ── REGULAR CONTENT PURCHASE ──

    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: 'Idempotency-Key header is required'
      });
    }

    console.log(`[Payment Verification] Starting verification for reference: ${reference}, currency: ${currency}`);

    // Verify payment with automatic routing
    const result = await paymentRoutingService.verifyPayment(reference, currency.toUpperCase(), idempotencyKey);

    if (result.cached) {
      console.log(`[Payment Verification] Returning cached result for reference: ${reference}`);
    }

    return res.status(result.success ? 200 : 400).json({
      success: result.success,
      message: result.message || (result.success ? 'Payment verified successfully' : 'Payment verification failed'),
      purchase: result.purchase,
      currency: currency.toUpperCase(),
      cached: result.cached || false,
      alreadyProcessed: result.alreadyProcessed || false
    });
  } catch (error) {
    console.error('[Payment Verification] Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify payment'
    });
  }
};

/**
 * Get student's purchase history
 * GET /api/payments/my-purchases
 */
exports.getMyPurchases = async (req, res) => {
  try {
    const userId = req.user.id;
    const { contentType } = req.query;

    const whereClause = {
      userId,
      paymentStatus: 'completed'
    };

    if (contentType && ['video', 'live_class', 'live_series'].includes(contentType)) {
      whereClause.contentType = contentType;
    }

    const purchases = await Purchase.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']]
    });

    // Enrich purchases with content details
    const enrichedPurchases = await Promise.all(
      purchases.map(async (purchase) => {
        const purchaseData = purchase.toJSON();
        
        if (purchase.contentType === 'video') {
          const video = await Video.findByPk(purchase.contentId, {
            attributes: ['id', 'title', 'thumbnailUrl', 'type', 'category']
          });
          purchaseData.content = video;
        } else if (purchase.contentType === 'live_class') {
          const liveClass = await LiveClass.findByPk(purchase.contentId, {
            attributes: ['id', 'title', 'thumbnailUrl', 'startTime', 'endTime', 'status']
          });
          purchaseData.content = liveClass;
        } else if (purchase.contentType === 'live_series') {
          const { LiveSeries } = require('../models/liveSeriesIndex');
          const liveSeries = await LiveSeries.findByPk(purchase.contentId, {
            attributes: ['id', 'title', 'thumbnailUrl', 'startDate', 'endDate', 'status', 'recurrencePattern']
          });
          purchaseData.content = liveSeries;
        }
        
        return purchaseData;
      })
    );

    return res.status(200).json({
      success: true,
      count: enrichedPurchases.length,
      purchases: enrichedPurchases
    });
  } catch (error) {
    console.error('Get purchases error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase history'
    });
  }
};

/**
 * Check if user owns content
 * GET /api/payments/check-access?contentType=video&contentId=xxx
 */
exports.checkOwnership = async (req, res) => {
  try {
    const userId = req.user.id;
    const { contentType, contentId } = req.query;

    if (!contentType || !contentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing contentType or contentId'
      });
    }

    // Check if content is free
    let content;
    if (contentType === 'video') {
      content = await Video.findByPk(contentId);
    } else if (contentType === 'live_class') {
      content = await LiveClass.findByPk(contentId);
    } else if (contentType === 'live_series') {
      const { LiveSeries } = require('../models/liveSeriesIndex');
      content = await LiveSeries.findByPk(contentId);
    }

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // If content is free, user has access
    if (parseFloat(content.price) === 0) {
      return res.status(200).json({
        success: true,
        hasAccess: true,
        reason: 'free_content'
      });
    }

    // Check if user purchased the content
    const purchase = await Purchase.findOne({
      where: {
        userId,
        contentType,
        contentId,
        paymentStatus: 'completed'
      }
    });

    if (purchase) {
      return res.status(200).json({
        success: true,
        hasAccess: true,
        reason: 'purchased',
        purchaseDate: purchase.createdAt,
        currency: purchase.currency
      });
    }

    // Get content currency and required gateway
    const contentCurrency = content.currency || 'NGN';
    const requiredGateway = paymentRoutingService.getGatewayForCurrency(contentCurrency);

    return res.status(200).json({
      success: true,
      hasAccess: false,
      reason: 'not_purchased',
      price: content.price,
      currency: contentCurrency,
      requiredGateway
    });
  } catch (error) {
    console.error('Check ownership error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check content access'
    });
  }
};

/**
 * Get payment configuration (supported currencies and gateways)
 * GET /api/payments/config
 */
exports.getPaymentConfig = async (req, res) => {
  try {
    const supportedCurrencies = paymentRoutingService.getSupportedCurrencies();
    const gatewayMapping = {};
    
    supportedCurrencies.forEach(currency => {
      gatewayMapping[currency] = paymentRoutingService.getGatewayForCurrency(currency);
    });

    return res.status(200).json({
      success: true,
      supportedCurrencies,
      gatewayMapping,
      defaultCurrency: 'NGN'
    });
  } catch (error) {
    console.error('Get payment config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get payment configuration'
    });
  }
};
