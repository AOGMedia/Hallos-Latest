const crypto = require('crypto');
const { PAYSTACK_WEBHOOK_SECRET } = require('../config/paystack');
const { STRIPE_WEBHOOK_SECRET, stripeClient } = require('../config/stripe');
const PaymentRoutingService = require('../services/paymentRoutingService');
const WebhookSecurityService = require('../services/webhookSecurityService');
const Purchase = require('../models/Purchase');
const Payout = require('../models/Payout');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const sequelize = require('../config/db');
const { sendPurchaseConfirmationEmail, sendSaleNotificationEmail } = require('../utils/email');
const User = require('../models/User');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');

// Initialize services
const paymentRoutingService = new PaymentRoutingService();
const webhookSecurityService = new WebhookSecurityService();

/**
 * Handle Paystack Webhook with Enhanced Security
 * POST /api/webhooks/paystack
 */
exports.handlePaystackWebhook = async (req, res) => {
  try {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const signature = req.headers['x-paystack-signature'];
    const payload = JSON.stringify(req.body);
    
    // Enhanced security validation
    const validationResult = await webhookSecurityService.validateWebhook({
      provider: 'paystack',
      payload,
      signature,
      secret: PAYSTACK_WEBHOOK_SECRET,
      eventId: req.body.data?.reference || `paystack_${Date.now()}`,
      clientIP
    });

    if (!validationResult.valid) {
      console.error('[Paystack Webhook] Security validation failed:', validationResult.message);
      return res.status(400).send('Webhook validation failed');
    }

    if (validationResult.duplicate) {
      console.log('[Paystack Webhook] Duplicate event, returning success');
      return res.status(200).send('Duplicate event processed');
    }

    const event = req.body;
    console.log('[Paystack Webhook] Processing event type:', event.event);

    // Handle charge.success event (payment completed)
    if (event.event === 'charge.success') {
      const { reference, amount, currency, metadata, customer } = event.data;

      // Extract metadata
      const userId = metadata.userId;
      const contentType = metadata.contentType;
      const contentId = metadata.contentId;

      // ── WALLET TOP-UP: handle separately, no Purchase record needed ──
      if (metadata.type === 'wallet_topup') {
        console.log('[Paystack Webhook] Processing wallet top-up:', reference);
        const MultiCurrencyWalletService = require('../services/multiCurrencyWalletService');
        const walletService = new MultiCurrencyWalletService();

        // Idempotency: check WalletTransaction
        const WalletTransaction = sequelize.models.WalletTransaction;
        if (WalletTransaction) {
          const existing = await WalletTransaction.findOne({ where: { reference } });
          if (existing) {
            console.log('[Paystack Webhook] Top-up already processed:', reference);
            return res.status(200).send('Already processed');
          }
        }

        await walletService.creditWallet({
          userId: parseInt(userId),
          currency: currency.toUpperCase(),
          amount: amount / 100,
          reference,
          description: 'Wallet top-up via Paystack',
          metadata: { gateway: 'paystack', type: 'topup', externalReference: reference }
        });

        console.log('[Paystack Webhook] Wallet top-up credited:', reference);
        return res.status(200).send('Webhook processed');
      }

      // ── CAMPAIGN REGISTRATION: handle separately ──
      if (metadata.type === 'campaign_registration') {
        console.log('[Paystack Webhook] Processing campaign registration payment:', reference);

        const CampaignRegistration = require('../models/CampaignRegistration');
        const { createQuizSession } = require('../services/campaignQuizService');
        const { sendCampaignQuizAccessEmail } = require('../utils/email');

        const registration = await CampaignRegistration.findOne({
          where: { paymentReference: reference }
        });

        if (!registration) {
          console.error('[Paystack Webhook] Campaign registration not found for reference:', reference);
          return res.status(200).send('Webhook processed');
        }

        if (registration.paymentStatus === 'completed') {
          console.log('[Paystack Webhook] Campaign registration already confirmed:', reference);
          return res.status(200).send('Already processed');
        }

        await registration.update({ paymentStatus: 'completed' });

        if (!registration.emailSent) {
          try {
            const { token } = await createQuizSession(registration.id, registration.email);
            await sendCampaignQuizAccessEmail(
              registration.email,
              registration.firstName,
              {
                lastName: registration.lastName,
                talent: registration.talent,
                location: registration.location,
                token
              }
            );
            await registration.update({ emailSent: true });
            console.log('[Paystack Webhook] Campaign quiz access email sent to:', registration.email);
          } catch (emailErr) {
            console.error('[Paystack Webhook] Campaign quiz email failed:', emailErr.message);
          }
        }

        console.log('[Paystack Webhook] Campaign registration confirmed:', reference);
        return res.status(200).send('Webhook processed');
      }

      // Check if already processed
      const existingPurchase = await Purchase.findOne({
        where: { paymentReference: reference }
      });

      if (existingPurchase) {
        console.log('[Paystack Webhook] Payment already processed:', reference);
        return res.status(200).send('Already processed');
      }

      // Process the payment using routing service
      const result = await paymentRoutingService.processSuccessfulPayment({
        paymentData: event.data,
        currency: currency.toUpperCase(),
        gateway: 'paystack',
        reference
      });

      // Create course enrollment if this is a course purchase
      if (contentType === 'course') {
        const CourseEnrollmentService = require('../services/courseEnrollmentService');
        const CoursePricingService = require('../services/coursePricingService');
        const courseEnrollmentService = new CourseEnrollmentService();
        const coursePricingService = new CoursePricingService();
        
        // Extract student details from metadata or customer data
        const studentName = customer.first_name && customer.last_name 
          ? `${customer.first_name} ${customer.last_name}` 
          : metadata.studentName || 'N/A';
        const studentEmail = customer.email || metadata.studentEmail || 'N/A';
        const studentPhone = metadata.studentPhone || 'N/A';
        
        // ✅ NEW: Extract access type and expiry from metadata
        const accessType = metadata.accessType || 'individual';
        const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt) : null;
        
        // ✅ NEW: For monthly/yearly, contentId is null
        const courseId = accessType === 'individual' ? contentId : null;
        
        await courseEnrollmentService.createEnrollment({
          userId,
          courseId,  // ✅ null for monthly/yearly
          purchaseId: result.purchase.id,
          studentName,
          studentEmail,
          studentPhone,
          accessType,  // ✅ NEW
          expiresAt    // ✅ NEW
        });
        
        console.log(`[Paystack Webhook] Course enrollment created - User: ${userId}, Access: ${accessType}, Expires: ${expiresAt || 'Never'}`);
      }

      // Log transaction
      await Transaction.create({
        userId,
        transactionType: 'purchase',
        amount: amount / 100,
        currency: currency.toUpperCase(),
        referenceType: 'purchase',
        referenceId: result.purchase.id,
        description: `Purchase of ${contentType} via Paystack`,
        metadata: { reference, gateway: 'paystack' }
      });

      // Send email notifications
      try {
        const user = await User.findByPk(userId);
        let content;
        if (contentType === 'video') {
          content = await Video.findByPk(contentId);
        } else if (contentType === 'live_class') {
          content = await LiveClass.findByPk(contentId);
        } else if (contentType === 'live_series') {
          const { LiveSeries } = require('../models/liveSeriesIndex');
          const { LiveSession } = require('../models/liveSeriesIndex');
          content = await LiveSeries.findByPk(contentId);
          
          // Get total sessions count for the series
          if (content) {
            const sessionsCount = await LiveSession.count({
              where: { seriesId: content.id }
            });
            content.totalSessions = sessionsCount;
          }
        } else if (contentType === 'course') {
          const Course = require('../models/Course');
          const Department = require('../models/Department');
          content = await Course.findByPk(contentId, {
            include: [{
              model: Department,
              as: 'department',
              attributes: ['name']
            }]
          });
        }

        if (user && content) {
          if (contentType === 'course') {
            // Send course enrollment confirmation email
            const { sendCourseEnrollmentConfirmationEmail } = require('../utils/email');
            await sendCourseEnrollmentConfirmationEmail(
              user.email,
              user.firstname,
              content.name,
              amount / 100,
              currency.toUpperCase(),
              content.department?.name || 'General'
            );
          } else if (contentType === 'live_series') {
            // Send live series purchase confirmation email
            const { sendLiveSeriesPurchaseEmail } = require('../utils/email');
            await sendLiveSeriesPurchaseEmail(
              user.email,
              user.firstname,
              content.title,
              content.totalSessions || 0,
              amount / 100,
              currency.toUpperCase(),
              content.startDate
            );
            
            // Send notification to creator
            const creator = await User.findByPk(content.userId);
            if (creator) {
              await sendSaleNotificationEmail(
                creator.email, 
                creator.firstname, 
                content.title, 
                user.firstname, 
                amount / 100,
                currency.toUpperCase()
              );
            }
          } else {
            // Send regular purchase confirmation to student
            await sendPurchaseConfirmationEmail(user.email, user.firstname, content.title, amount / 100);
            
            // Send notification to creator
            const creator = await User.findByPk(content.userId);
            if (creator) {
              await sendSaleNotificationEmail(creator.email, creator.firstname, content.title, user.firstname, amount / 100);
            }
          }
        }
      } catch (emailError) {
        console.error('[Paystack Webhook] Email notification error:', emailError);
        // Don't fail the webhook if email fails
      }

      console.log('[Paystack Webhook] Payment processed successfully:', reference);
    }

    // Handle transfer.success event (payout completed)
    if (event.event === 'transfer.success') {
      const { reference, amount, recipient } = event.data;

      const payout = await Payout.findOne({
        where: { transferReference: reference }
      });

      if (payout) {
        // Update payout status
        payout.status = 'completed';
        await payout.save();

        // Update wallet
        const wallet = await Wallet.findOne({
          where: { userId: payout.userId }
        });

        if (wallet) {
          // Move from pending to withdrawn
          wallet.withdrawnAmount = parseFloat(wallet.withdrawnAmount) + parseFloat(payout.amount);
          wallet.pendingAmount = parseFloat(wallet.pendingAmount) - parseFloat(payout.amount);
          await wallet.save();
        }

        // Log transaction
        await Transaction.create({
          userId: payout.userId,
          transactionType: 'payout',
          amount: payout.netAmount,
          currency: payout.currency,
          referenceType: 'payout',
          referenceId: payout.id,
          description: 'Withdrawal via Paystack',
          metadata: { reference, gateway: 'paystack' }
        });

        // Send email notification
        try {
          const user = await User.findByPk(payout.userId);
          if (user) {
            const { sendWithdrawalConfirmationEmail } = require('../utils/email');
            await sendWithdrawalConfirmationEmail(
              user.email,
              user.firstname,
              payout.amount,
              payout.netAmount,
              payout.bankName,
              payout.accountNumber
            );
          }
        } catch (emailError) {
          console.error('[Paystack Webhook] Email notification error:', emailError);
        }

        console.log('[Paystack Webhook] Payout completed:', reference);
      }
    }

    // Handle transfer.failed event (payout failed)
    if (event.event === 'transfer.failed') {
      const { reference } = event.data;

      const payout = await Payout.findOne({
        where: { transferReference: reference }
      });

      if (payout) {
        // Update payout status
        payout.status = 'failed';
        payout.failureReason = event.data.message || 'Transfer failed';
        await payout.save();

        // Release locked amount in wallet
        const wallet = await Wallet.findOne({
          where: { userId: payout.userId }
        });

        if (wallet) {
          wallet.pendingAmount = parseFloat(wallet.pendingAmount) - parseFloat(payout.amount);
          await wallet.save();
        }

        // Send email notification
        try {
          const user = await User.findByPk(payout.userId);
          if (user) {
            const { sendWithdrawalFailureEmail } = require('../utils/email');
            await sendWithdrawalFailureEmail(
              user.email,
              user.firstname,
              payout.amount,
              payout.failureReason
            );
          }
        } catch (emailError) {
          console.error('[Paystack Webhook] Email notification error:', emailError);
        }

        console.log('[Paystack Webhook] Payout failed:', reference);
      }
    }

    return res.status(200).send('Webhook processed');
  } catch (error) {
    console.error('[Paystack Webhook] Error:', error);
    return res.status(500).send('Webhook processing error');
  }
};

/**
 * Get webhook security statistics
 * GET /api/webhooks/security/stats
 */
exports.getWebhookSecurityStats = async (req, res) => {
  try {
    const stats = webhookSecurityService.getSecurityStats();
    
    return res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[Webhook Security] Get stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get security statistics'
    });
  }
};

/**
 * Block IP address (admin endpoint)
 * POST /api/webhooks/security/block-ip
 */
exports.blockIP = async (req, res) => {
  try {
    const { ip, reason } = req.body;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        message: 'IP address is required'
      });
    }
    
    webhookSecurityService.blockIP(ip, reason || 'Manual block');
    
    return res.status(200).json({
      success: true,
      message: `IP ${ip} has been blocked`
    });
  } catch (error) {
    console.error('[Webhook Security] Block IP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to block IP address'
    });
  }
};

/**
 * Unblock IP address (admin endpoint)
 * POST /api/webhooks/security/unblock-ip
 */
exports.unblockIP = async (req, res) => {
  try {
    const { ip } = req.body;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        message: 'IP address is required'
      });
    }
    
    webhookSecurityService.unblockIP(ip);
    
    return res.status(200).json({
      success: true,
      message: `IP ${ip} has been unblocked`
    });
  } catch (error) {
    console.error('[Webhook Security] Unblock IP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to unblock IP address'
    });
  }
};

/**
 * Handle Stripe Webhook with Enhanced Security
 * POST /api/webhooks/stripe
 */
exports.handleStripeWebhook = async (req, res) => {
  try {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const signature = req.headers['stripe-signature'];
    
    // req.body is a Buffer from express.raw(), convert to string for Stripe
    const payload = req.body.toString('utf8');
    
    // Parse event using Stripe's method first for signature validation
    let event;
    try {
      event = stripeClient.webhooks.constructEvent(
        payload,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Enhanced security validation (after Stripe verification)
    const validationResult = await webhookSecurityService.validateWebhook({
      provider: 'stripe',
      payload,
      signature,
      secret: STRIPE_WEBHOOK_SECRET,
      eventId: event.id || `stripe_${Date.now()}`,
      clientIP
    });

    if (!validationResult.valid) {
      console.error('[Stripe Webhook] Security validation failed:', validationResult.message);
      return res.status(400).send('Webhook validation failed');
    }

    if (validationResult.duplicate) {
      console.log('[Stripe Webhook] Duplicate event, returning success');
      return res.status(200).json({ received: true });
    }

    console.log('[Stripe Webhook] Processing event type:', event.type);

    // Handle checkout.session.completed event (payment completed)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // Extract metadata
      const userId = parseInt(session.metadata.userId);
      const contentType = session.metadata.contentType;
      const contentId = session.metadata.contentId === 'null' ? null : session.metadata.contentId;  // Handle string 'null'
      const email = session.metadata.email;

      // ── WALLET TOP-UP: handle separately, no Purchase record needed ──
      if (session.metadata.type === 'wallet_topup') {
        console.log('[Stripe Webhook] Processing wallet top-up:', session.id);
        const MultiCurrencyWalletService = require('../services/multiCurrencyWalletService');
        const walletService = new MultiCurrencyWalletService();

        const WalletTransaction = sequelize.models.WalletTransaction;
        if (WalletTransaction) {
          const existing = await WalletTransaction.findOne({ where: { reference: session.id } });
          if (existing) {
            console.log('[Stripe Webhook] Top-up already processed:', session.id);
            return res.status(200).json({ received: true });
          }
        }

        await walletService.creditWallet({
          userId,
          currency: 'USD',
          amount: session.amount_total / 100,
          reference: session.id,
          description: 'Wallet top-up via Stripe',
          metadata: { gateway: 'stripe', type: 'topup', externalReference: session.id }
        });

        console.log('[Stripe Webhook] Wallet top-up credited:', session.id);
        return res.status(200).json({ received: true });
      }

      // Check if already processed
      const existingPurchase = await Purchase.findOne({
        where: { paymentReference: session.id }
      });

      if (existingPurchase) {
        console.log('[Stripe Webhook] Payment already processed:', session.id);
        return res.status(200).json({ received: true });
      }

      // Process the payment using routing service
      const result = await paymentRoutingService.processSuccessfulPayment({
        paymentData: session,
        currency: session.currency.toUpperCase(),
        gateway: 'stripe',
        reference: session.id
      });

      // Create course enrollment if this is a course purchase
      if (contentType === 'course') {
        const CourseEnrollmentService = require('../services/courseEnrollmentService');
        const CoursePricingService = require('../services/coursePricingService');
        const courseEnrollmentService = new CourseEnrollmentService();
        const coursePricingService = new CoursePricingService();
        
        // Extract student details from metadata
        const studentName = session.metadata.studentName || 'N/A';
        const studentEmail = session.metadata.studentEmail || email || 'N/A';
        const studentPhone = session.metadata.studentPhone || 'N/A';
        
        // ✅ NEW: Extract access type and expiry from metadata
        const accessType = session.metadata.accessType || 'individual';
        const expiresAt = session.metadata.expiresAt ? new Date(session.metadata.expiresAt) : null;
        
        // ✅ NEW: For monthly/yearly, contentId is null
        const courseId = accessType === 'individual' ? contentId : null;
        
        await courseEnrollmentService.createEnrollment({
          userId,
          courseId,  // ✅ null for monthly/yearly
          purchaseId: result.purchase.id,
          studentName,
          studentEmail,
          studentPhone,
          accessType,  // ✅ NEW
          expiresAt    // ✅ NEW
        });
        
        console.log(`[Stripe Webhook] Course enrollment created - User: ${userId}, Access: ${accessType}, Expires: ${expiresAt || 'Never'}`);
      }

      // Log transaction
      await Transaction.create({
        userId,
        transactionType: 'purchase',
        amount: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
        referenceType: 'purchase',
        referenceId: result.purchase.id,
        description: `Purchase of ${contentType} via Stripe`,
        metadata: { sessionId: session.id, gateway: 'stripe' }
      });

      // Send email notifications
      try {
        const user = await User.findByPk(userId);
        let content;
        if (contentType === 'video') {
          content = await Video.findByPk(contentId);
        } else if (contentType === 'live_class') {
          content = await LiveClass.findByPk(contentId);
        } else if (contentType === 'live_series') {
          const { LiveSeries } = require('../models/liveSeriesIndex');
          const { LiveSession } = require('../models/liveSeriesIndex');
          content = await LiveSeries.findByPk(contentId);
          
          // Get total sessions count for the series
          if (content) {
            const sessionsCount = await LiveSession.count({
              where: { seriesId: content.id }
            });
            content.totalSessions = sessionsCount;
          }
        } else if (contentType === 'course') {
          const Course = require('../models/Course');
          const Department = require('../models/Department');
          content = await Course.findByPk(contentId, {
            include: [{
              model: Department,
              as: 'department',
              attributes: ['name']
            }]
          });
        }

        if (user && content) {
          if (contentType === 'course') {
            // Send course enrollment confirmation email
            const { sendCourseEnrollmentConfirmationEmail } = require('../utils/email');
            await sendCourseEnrollmentConfirmationEmail(
              user.email,
              user.firstname,
              content.name,
              session.amount_total / 100,
              session.currency.toUpperCase(),
              content.department?.name || 'General'
            );
          } else if (contentType === 'live_series') {
            // Send live series purchase confirmation email
            const { sendLiveSeriesPurchaseEmail } = require('../utils/email');
            await sendLiveSeriesPurchaseEmail(
              user.email,
              user.firstname,
              content.title,
              content.totalSessions || 0,
              session.amount_total / 100,
              session.currency.toUpperCase(),
              content.startDate
            );
            
            // Send notification to creator
            const creator = await User.findByPk(content.userId);
            if (creator) {
              await sendSaleNotificationEmail(
                creator.email, 
                creator.firstname, 
                content.title, 
                user.firstname, 
                session.amount_total / 100,
                session.currency.toUpperCase()
              );
            }
          } else {
            // Send regular purchase confirmation to student
            await sendPurchaseConfirmationEmail(user.email, user.firstname, content.title, session.amount_total / 100);
            
            // Send notification to creator
            const creator = await User.findByPk(content.userId);
            if (creator) {
              await sendSaleNotificationEmail(creator.email, creator.firstname, content.title, user.firstname, session.amount_total / 100);
            }
          }
        }
      } catch (emailError) {
        console.error('[Stripe Webhook] Email notification error:', emailError);
        // Don't fail the webhook if email fails
      }

      console.log('[Stripe Webhook] Payment processed successfully:', session.id);
    }

    // Handle transfer.created event (payout initiated)
    if (event.type === 'transfer.created') {
      const transfer = event.data.object;
      console.log('[Stripe Webhook] Transfer created:', transfer.id);
    }

    // Handle transfer.updated event (payout status changed)
    if (event.type === 'transfer.updated') {
      const transfer = event.data.object;

      const payout = await Payout.findOne({
        where: { transferReference: transfer.id }
      });

      if (payout) {
        if (transfer.status === 'paid') {
          // Update payout status
          payout.status = 'completed';
          await payout.save();

          // Update wallet
          const wallet = await Wallet.findOne({
            where: { userId: payout.userId }
          });

          if (wallet) {
            wallet.withdrawnAmount = parseFloat(wallet.withdrawnAmount) + parseFloat(payout.amount);
            wallet.pendingAmount = parseFloat(wallet.pendingAmount) - parseFloat(payout.amount);
            await wallet.save();
          }

          // Log transaction
          await Transaction.create({
            userId: payout.userId,
            transactionType: 'payout',
            amount: payout.netAmount,
            currency: payout.currency,
            referenceType: 'payout',
            referenceId: payout.id,
            description: 'Withdrawal via Stripe',
            metadata: { transferId: transfer.id, gateway: 'stripe' }
          });

          // Send email notification
          try {
            const user = await User.findByPk(payout.userId);
            if (user) {
              const { sendWithdrawalConfirmationEmail } = require('../utils/email');
              await sendWithdrawalConfirmationEmail(
                user.email,
                user.firstname,
                payout.amount,
                payout.netAmount,
                payout.bankName,
                payout.accountNumber
              );
            }
          } catch (emailError) {
            console.error('[Stripe Webhook] Email notification error:', emailError);
          }

          console.log('[Stripe Webhook] Payout completed:', transfer.id);
        } else if (transfer.status === 'failed') {
          // Update payout status
          payout.status = 'failed';
          payout.failureReason = transfer.failure_message || 'Transfer failed';
          await payout.save();

          // Release locked amount in wallet
          const wallet = await Wallet.findOne({
            where: { userId: payout.userId }
          });

          if (wallet) {
            wallet.pendingAmount = parseFloat(wallet.pendingAmount) - parseFloat(payout.amount);
            await wallet.save();
          }

          // Send email notification
          try {
            const user = await User.findByPk(payout.userId);
            if (user) {
              const { sendWithdrawalFailureEmail } = require('../utils/email');
              await sendWithdrawalFailureEmail(
                user.email,
                user.firstname,
                payout.amount,
                payout.failureReason
              );
            }
          } catch (emailError) {
            console.error('[Stripe Webhook] Email notification error:', emailError);
          }

          console.log('[Stripe Webhook] Payout failed:', transfer.id);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Stripe Webhook] Error:', error);
    return res.status(500).send('Webhook processing error');
  }
};
