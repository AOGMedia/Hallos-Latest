const { paystackClient } = require('../config/paystack');
const { stripeClient } = require('../config/stripe');
const MultiCurrencyWalletService = require('./multiCurrencyWalletService');
const CurrencyConversionService = require('./currencyConversionService');
const { idempotencyService } = require('./idempotencyService');
const CouponService = require('./couponService');
const Purchase = require('../models/Purchase');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');
const sequelize = require('../config/db');

/**
 * Enhanced Payment Routing Service
 * 
 * Provides secure payment processing with:
 * - Currency-based gateway routing (NGN→Paystack, USD→Stripe)
 * - Multi-currency wallet integration
 * - Idempotency protection
 * - Gateway selection validation
 * - Enhanced error handling and retry mechanisms
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

class PaymentRoutingService {
  constructor() {
    this.walletService = new MultiCurrencyWalletService();
    this.conversionService = new CurrencyConversionService();
    this.idempotencyService = idempotencyService;
    this.couponService = new CouponService();
    
    // Gateway routing configuration
    this.gatewayRouting = {
      'NGN': {
        gateway: 'paystack',
        client: paystackClient,
        processor: this.processPaystackPayment.bind(this),
        verifier: this.verifyPaystackPayment.bind(this)
      },
      'USD': {
        gateway: 'stripe',
        client: stripeClient,
        processor: this.processStripePayment.bind(this),
        verifier: this.verifyStripePayment.bind(this)
      }
    };

    // Content currency mapping (determines which gateway to use)
    this.contentCurrencyMapping = {
      'video': this.getContentCurrency.bind(this),
      'live_class': this.getContentCurrency.bind(this),
      'course': this.getContentCurrency.bind(this)
    };
  }

  /**
   * Initialize payment with automatic gateway routing
   * @param {Object} params - Payment parameters
   * @param {number} params.userId - User ID
   * @param {string} params.contentType - Content type (video/live_class/course/live_series)
   * @param {string} params.contentId - Content ID
   * @param {string} params.userEmail - User email
   * @param {string} params.idempotencyKey - Idempotency key
   * @param {string} params.forceCurrency - Optional currency override
   * @param {string} params.couponCode - Optional coupon code (for live series)
   * @param {string} params.referralCode - Optional referral code
   * @param {Object} params.metadata - Optional metadata (required for courses)
   * @returns {Promise<Object>} Payment initialization result
   */
  async initializePayment({ userId, contentType, contentId, userEmail, idempotencyKey, forceCurrency = null, couponCode = null, referralCode = null, metadata = {} }) {
    try {
      // Validate idempotency
      const idempotencyResult = await this.idempotencyService.checkAndStore(
        idempotencyKey,
        userId,
        'payment_initialization',
        { contentType, contentId, forceCurrency, couponCode, referralCode }
      );

      if (!idempotencyResult.isNew) {
        return {
          success: true,
          cached: true,
          data: idempotencyResult.storedResult
        };
      }

      // Referral tracking — new system links referrals at signup, not at payment time
      // referralCode in metadata is kept for traceability only
      let referralValidation = null;

      // Get content details and determine currency
      const contentDetails = await this.getContentDetails(contentType, contentId);
      if (!contentDetails) {
        throw new Error(`${contentType} not found`);
      }

      // For freebies: prevent creator from buying their own content
      if (contentType === 'freebie' && contentDetails.userId === userId) {
        throw new Error('You cannot purchase your own freebie');
      }

      // Determine currency and price for courses
      let currency, amount, couponValidation = null;
      if (contentType === 'course') {
        // ✅ For courses, use forced currency and price from metadata
        // Pricing is now managed by CoursePricingService via .env
        currency = forceCurrency || 'NGN';
        this.walletService.validateCurrency(currency);
        
        // ✅ Get price from metadata.finalPrice (set by course controller)
        if (!metadata || !metadata.finalPrice) {
          throw new Error('Course price must be provided in metadata.finalPrice');
        }
        amount = parseFloat(metadata.finalPrice);
      } else {
        // For videos, live classes, and live series - handle currency conversion
        const baseCurrency = contentDetails.currency || 'NGN';
        let baseAmount = parseFloat(contentDetails.price);
        
        // Apply coupon discount using new database-driven system
        if (couponCode) {
          try {
            couponValidation = await this.couponService.validateCoupon(
              couponCode,
              contentType,
              contentId,
              userId,
              forceCurrency || baseCurrency  // pass the target currency
            );
            
            if (couponValidation.valid) {
              // Use the final price from coupon validation
              baseAmount = couponValidation.finalPrice;
              console.log(`[Payment Routing] Coupon ${couponCode} applied: ${contentDetails.price} → ${baseAmount} ${baseCurrency}`);
              
              // Store coupon data for later use
              metadata.couponId = couponValidation.coupon.id;
              metadata.couponCode = couponValidation.coupon.code;
              metadata.originalPrice = couponValidation.originalPrice;
              metadata.discountAmount = couponValidation.discountAmount;
              metadata.partnerCommission = couponValidation.partnerCommission;
              metadata.couponPartnerUserId = couponValidation.coupon.partnerUserId || null;
            } else {
              console.log(`[Payment Routing] Invalid coupon ${couponCode}: ${couponValidation.error}`);
              throw new Error(couponValidation.error);
            }
          } catch (couponError) {
            console.error('[Payment Routing] Coupon validation error:', couponError);
            throw couponError;
          }
        }
        
        // Determine target currency
        currency = forceCurrency || baseCurrency;
        this.walletService.validateCurrency(currency);
        
        // Convert price if user selected different currency than content's base currency
        // Skip conversion if coupon already returned price in target currency
        if (currency !== baseCurrency && !couponValidation) {
          amount = this.conversionService.convert(baseAmount, baseCurrency, currency);
          console.log(`[Payment Routing] Currency conversion: ${baseAmount} ${baseCurrency} → ${amount} ${currency}`);
        } else {
          amount = baseAmount;
        }
      }
      
      // Validate currency and get required gateway
      this.walletService.validateCurrency(currency);
      const requiredGateway = this.walletService.getRequiredGateway(currency);

      // Check if content is free (after coupon discount)
      if (amount === 0) {
        // Create purchase record directly for free access (100% coupon discount)
        const transaction = await sequelize.transaction();
        
        try {
          // Use the gateway that would have been used (based on currency)
          // This keeps the enum valid while the reference shows it's a coupon
          const gatewayForCurrency = currency === 'USD' ? 'stripe' : 'paystack';
          
          const purchase = await Purchase.create({
            userId,
            contentType,
            contentId,
            amount: 0,
            currency,
            paymentGateway: gatewayForCurrency,
            paymentReference: `COUPON-${couponCode || 'FREE'}-${Date.now()}`,
            paymentStatus: 'completed',
            couponId: metadata.couponId || null
          }, { transaction });

          // Record coupon usage if coupon was applied
          if (couponValidation && couponValidation.valid) {
            await this.couponService.recordCouponUsage({
              couponId: metadata.couponId,
              userId,
              purchaseId: purchase.id,
              originalPrice: metadata.originalPrice,
              discountAmount: metadata.discountAmount,
              finalPrice: 0,
              partnerCommissionAmount: metadata.partnerCommission,
              contentType,
              contentId,
              currency
            });
            
            console.log(`[Payment Routing] Recorded coupon usage for ${couponCode}`);
          }

          await transaction.commit();

          console.log(`[Payment Routing] Free access granted via coupon ${couponCode} for user ${userId}`);

          const result = {
            success: true,
            freeAccess: true,
            couponApplied: true,
            couponCode: couponCode || null,
            purchase,
            message: couponCode 
              ? `Coupon ${couponCode} applied! You now have full access.`
              : 'This content is free. Access granted.',
            currency,
            amount: 0
          };

          // Cache successful result
          await this.idempotencyService.storeResult(idempotencyKey, result, 'completed');

          return result;
        } catch (error) {
          await transaction.rollback();
          console.error('[Payment Routing] Free access creation error:', error);
          console.error('[Payment Routing] Error details:', error.message);
          console.error('[Payment Routing] Error stack:', error.stack);
          throw error; // Throw the actual error, not a generic message
        }
      }

      // Check for existing purchase
      await this.validateNoDuplicatePurchase(userId, contentType, contentId);

      // Route to appropriate gateway
      const gatewayConfig = this.gatewayRouting[currency];
      if (!gatewayConfig) {
        throw new Error(`No gateway configuration found for currency: ${currency}`);
      }

      console.log(`[Payment Routing] Routing ${currency} payment to ${gatewayConfig.gateway} for user ${userId}`);

      // Initialize payment with selected gateway
      const paymentResult = await gatewayConfig.processor({
        userId,
        contentType,
        contentId,
        amount,
        currency,
        email: userEmail,
        contentTitle: contentDetails.title || contentDetails.name || `${contentType} purchase`,
        metadata: {
          referralCode: metadata.referralCode || null,
          referrerUserId: metadata.referrerUserId || null,
          couponCode: metadata.couponCode || null,
          couponId: metadata.couponId || null,
          originalPrice: metadata.originalPrice || null,
          discountAmount: metadata.discountAmount || null,
          partnerCommission: metadata.partnerCommission || null
        }
      });

      // Cache successful result
      await this.idempotencyService.storeResult(idempotencyKey, paymentResult, 'completed');

      return {
        success: true,
        currency,
        gateway: gatewayConfig.gateway,
        requiredGateway,
        data: paymentResult
      };

    } catch (error) {
      console.error('[Payment Routing] Initialize payment error:', error);
      
      // Cache error response for idempotency
      const errorResponse = {
        success: false,
        message: error.message
      };
      
      try {
        await this.idempotencyService.storeResult(idempotencyKey, errorResponse, 'failed');
      } catch (cacheError) {
        console.error('[Payment Routing] Failed to cache error response:', cacheError);
      }
      
      throw error;
    }
  }

  /**
   * Verify payment with automatic gateway detection
   * @param {string} reference - Payment reference
   * @param {string} currency - Currency code
   * @param {string} idempotencyKey - Idempotency key
   * @returns {Promise<Object>} Verification result
   */
  async verifyPayment(reference, currency, idempotencyKey) {
    try {
      // First, get payment data to extract userId for idempotency
      this.walletService.validateCurrency(currency);
      const gatewayConfig = this.gatewayRouting[currency];
      
      if (!gatewayConfig) {
        throw new Error(`No gateway configuration found for currency: ${currency}`);
      }

      // Verify with gateway to get payment data (including userId)
      const verificationResult = await gatewayConfig.verifier(reference);
      
      if (!verificationResult.success) {
        throw new Error(verificationResult.message || 'Payment verification failed');
      }

      // Extract userId from payment data
      const paymentData = verificationResult.data;
      let userId;
      
      if (gatewayConfig.gateway === 'paystack') {
        userId = parseInt(paymentData.metadata.userId);
      } else if (gatewayConfig.gateway === 'stripe') {
        userId = parseInt(paymentData.metadata.userId);
      }

      if (!userId) {
        throw new Error('Unable to extract user ID from payment data');
      }

      // Now validate idempotency with proper userId
      const idempotencyResult = await this.idempotencyService.checkAndStore(
        idempotencyKey,
        userId,
        'payment_verification',
        { reference, currency }
      );

      if (!idempotencyResult.isNew) {
        return {
          success: true,
          cached: true,
          data: idempotencyResult.storedResult
        };
      }

      // Check if already processed
      const existingPurchase = await Purchase.findOne({
        where: { paymentReference: reference }
      });

      if (existingPurchase) {
        const result = {
          success: true,
          alreadyProcessed: true,
          purchase: existingPurchase,
          currency,
          gateway: existingPurchase.paymentGateway,
          message: 'Payment already processed'
        };
        
        await this.idempotencyService.storeResult(idempotencyKey, result, 'completed');
        return result;
      }

      // Route to appropriate gateway for verification
      console.log(`[Payment Routing] Verifying ${currency} payment via ${gatewayConfig.gateway}`);

      // We already verified above, so use the existing result
      if (!verificationResult.success) {
        const errorResult = {
          success: false,
          message: verificationResult.message || 'Payment verification failed'
        };
        
        await this.idempotencyService.storeResult(idempotencyKey, errorResult, 'failed');
        return errorResult;
      }

      // Process successful payment
      const processedPayment = await this.processSuccessfulPayment({
        paymentData,
        currency,
        gateway: gatewayConfig.gateway,
        reference
      });

      // Cache successful result
      await this.idempotencyService.storeResult(idempotencyKey, processedPayment, 'completed');

      return processedPayment;

    } catch (error) {
      console.error('[Payment Routing] Verify payment error:', error);
      
      const errorResponse = {
        success: false,
        message: error.message || 'Payment verification failed'
      };
      
      try {
        await this.idempotencyService.storeResult(idempotencyKey, errorResponse, 'failed');
      } catch (cacheError) {
        console.error('[Payment Routing] Failed to cache error response:', cacheError);
      }
      
      throw error;
    }
  }

  /**
   * Process Paystack payment initialization
   */
  async processPaystackPayment({ userId, contentType, contentId, amount, currency, email, contentTitle, metadata = {} }) {
    try {
      // Build custom fields, excluding null contentId
      const customFields = [
        {
          display_name: 'Content Type',
          variable_name: 'content_type',
          value: contentType
        },
        {
          display_name: 'Content Title',
          variable_name: 'content_title',
          value: contentTitle
        }
      ];
      
      // Only add Content ID field if not null
      if (contentId) {
        customFields.push({
          display_name: 'Content ID',
          variable_name: 'content_id',
          value: contentId.toString()
        });
      }
      
      const response = await paystackClient.post('/transaction/initialize', {
        email,
        amount: Math.round(amount * 100), // Convert to kobo
        currency: currency.toUpperCase(),
        metadata: {
          userId: userId.toString(),
          contentType,
          contentId: contentId ? contentId.toString() : null,  // Handle null
          referralCode: metadata.referralCode || null,
          referrerUserId: metadata.referrerUserId ? metadata.referrerUserId.toString() : null,
          couponCode: metadata.couponCode || null,
          couponId: metadata.couponId ? metadata.couponId.toString() : null,
          originalPrice: metadata.originalPrice ? metadata.originalPrice.toString() : null,
          discountAmount: metadata.discountAmount ? metadata.discountAmount.toString() : null,
          partnerCommission: metadata.partnerCommission ? metadata.partnerCommission.toString() : null,
          couponPartnerUserId: metadata.couponPartnerUserId ? metadata.couponPartnerUserId.toString() : null,
          custom_fields: customFields
        },
        callback_url: `${process.env.CLIENT_URL}/payments/verify`
      });

      return {
        success: true,
        authorizationUrl: response.data.data.authorization_url,
        accessCode: response.data.data.access_code,
        reference: response.data.data.reference,
        gateway: 'paystack',
        currency
      };
    } catch (error) {
      console.error('[Payment Routing] Paystack initialization error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to initialize Paystack payment');
    }
  }

  /**
   * Process Stripe payment initialization
   */
  async processStripePayment({ userId, contentType, contentId, amount, currency, email, contentTitle, metadata = {} }) {
    try {
      const session = await stripeClient.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: currency.toLowerCase(),
              product_data: {
                name: contentTitle,
                description: `Purchase access to ${contentType.replace('_', ' ')}`
              },
              unit_amount: Math.round(amount * 100) // Convert to cents
            },
            quantity: 1
          }
        ],
        mode: 'payment',
        success_url: `${process.env.CLIENT_URL}/payments/verify?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/payments/verify?cancelled=true`,
        client_reference_id: userId.toString(),
        metadata: {
          userId: userId.toString(),
          contentType,
          contentId: contentId ? contentId.toString() : 'null',  // Handle null, Stripe doesn't accept null
          email,
          contentTitle,
          referralCode: metadata.referralCode || '',
          referrerUserId: metadata.referrerUserId ? metadata.referrerUserId.toString() : '',
          couponCode: metadata.couponCode || '',
          couponId: metadata.couponId ? metadata.couponId.toString() : '',
          originalPrice: metadata.originalPrice ? metadata.originalPrice.toString() : '',
          discountAmount: metadata.discountAmount ? metadata.discountAmount.toString() : '',
          partnerCommission: metadata.partnerCommission ? metadata.partnerCommission.toString() : '',
          couponPartnerUserId: metadata.couponPartnerUserId ? metadata.couponPartnerUserId.toString() : ''
        }
      });

      return {
        success: true,
        sessionId: session.id,
        checkoutUrl: session.url,
        reference: session.id,
        gateway: 'stripe',
        currency
      };
    } catch (error) {
      console.error('[Payment Routing] Stripe initialization error:', error.message);
      throw new Error(error.message || 'Failed to initialize Stripe payment');
    }
  }

  /**
   * Verify Paystack payment
   */
  async verifyPaystackPayment(reference) {
    try {
      const response = await paystackClient.get(`/transaction/verify/${reference}`);
      
      if (response.data.data.status === 'success') {
        return {
          success: true,
          data: response.data.data
        };
      }
      
      return {
        success: false,
        message: 'Payment not successful'
      };
    } catch (error) {
      console.error('[Payment Routing] Paystack verification error:', error.response?.data || error.message);
      throw new Error('Failed to verify Paystack payment');
    }
  }

  /**
   * Verify Stripe payment
   */
  async verifyStripePayment(sessionId) {
    try {
      const session = await stripeClient.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status === 'paid') {
        return {
          success: true,
          data: session
        };
      }
      
      return {
        success: false,
        message: 'Payment not completed'
      };
    } catch (error) {
      console.error('[Payment Routing] Stripe verification error:', error.message);
      throw new Error('Failed to verify Stripe payment');
    }
  }

  /**
   * Process successful payment and update multi-currency wallet
   */
  async processSuccessfulPayment({ paymentData, currency, gateway, reference }) {
    // Check if payment was already processed (idempotent check)
    const existingPurchase = await Purchase.findOne({
      where: { paymentReference: reference }
    });

    if (existingPurchase) {
      console.log(`[Payment Routing] Payment ${reference} already processed, returning existing purchase`);
      return {
        success: true,
        purchase: existingPurchase,
        currency,
        gateway,
        message: 'Payment already processed',
        alreadyProcessed: true
      };
    }

    const transaction = await sequelize.transaction();
    
    try {
      // Extract payment details based on gateway
      let userId, contentType, contentId, amount;
      
      if (gateway === 'paystack') {
        userId = parseInt(paymentData.metadata.userId);
        contentType = paymentData.metadata.contentType;
        contentId = paymentData.metadata.contentId;
        amount = paymentData.amount / 100; // Convert from kobo
      } else if (gateway === 'stripe') {
        userId = parseInt(paymentData.metadata.userId);
        contentType = paymentData.metadata.contentType;
        contentId = paymentData.metadata.contentId;
        amount = paymentData.amount_total / 100; // Convert from cents
      }

      console.log(`[Payment Routing] Processing ${currency} payment for user ${userId}, ${contentType} ${contentId}`);

      // Extract coupon data from payment metadata
      let couponId = null, originalPrice = null, discountAmount = null, partnerCommission = null, couponPartnerUserId = null;
      if (gateway === 'paystack') {
        couponId = paymentData.metadata.couponId ? paymentData.metadata.couponId : null;
        originalPrice = paymentData.metadata.originalPrice ? parseFloat(paymentData.metadata.originalPrice) : null;
        discountAmount = paymentData.metadata.discountAmount ? parseFloat(paymentData.metadata.discountAmount) : null;
        partnerCommission = paymentData.metadata.partnerCommission ? parseFloat(paymentData.metadata.partnerCommission) : null;
        couponPartnerUserId = paymentData.metadata.couponPartnerUserId ? parseInt(paymentData.metadata.couponPartnerUserId) : null;
      } else if (gateway === 'stripe') {
        couponId = paymentData.metadata.couponId || null;
        originalPrice = paymentData.metadata.originalPrice ? parseFloat(paymentData.metadata.originalPrice) : null;
        discountAmount = paymentData.metadata.discountAmount ? parseFloat(paymentData.metadata.discountAmount) : null;
        partnerCommission = paymentData.metadata.partnerCommission ? parseFloat(paymentData.metadata.partnerCommission) : null;
        couponPartnerUserId = paymentData.metadata.couponPartnerUserId ? parseInt(paymentData.metadata.couponPartnerUserId) : null;
      }

      // Fallback: if couponId exists but partnerUserId missing from metadata, fetch from DB
      if (couponId && !couponPartnerUserId) {
        try {
          const Coupon = require('../models/Coupon');
          const coupon = await Coupon.findByPk(couponId, { attributes: ['partnerUserId', 'partnerCommissionPercent'] });
          if (coupon && coupon.partnerUserId) {
            couponPartnerUserId = coupon.partnerUserId;
            console.log(`[Payment Routing] Fetched partnerUserId ${couponPartnerUserId} from DB for coupon ${couponId}`);
          }
        } catch (err) {
          console.error(`[Payment Routing] Failed to fetch coupon partnerUserId from DB:`, err.message);
        }
      }

      // Create purchase record
      const purchase = await Purchase.create({
        userId,
        contentType,
        contentId,
        amount,
        currency,
        paymentGateway: gateway,
        paymentReference: reference,
        paymentStatus: 'completed',
        couponId: couponId
      }, { transaction });

      // Record coupon usage if coupon was applied
      if (couponId) {
        try {
          await this.couponService.recordCouponUsage({
            couponId,
            userId,
            purchaseId: purchase.id,
            originalPrice: originalPrice || amount,
            discountAmount: discountAmount || 0,
            finalPrice: amount,
            partnerCommissionAmount: partnerCommission,
            contentType,
            contentId,
            currency
          }, transaction);
          
          console.log(`[Payment Routing] Recorded coupon usage for purchase ${purchase.id}`);
        } catch (couponError) {
          console.error(`[Payment Routing] Failed to record coupon usage:`, couponError.message);
          // Don't throw - purchase should succeed even if coupon recording fails
        }
      }

      // For freebies: create FreebieAccess record in addition to Purchase record
      if (contentType === 'freebie') {
        const { FreebieAccess } = require('../models/freebieIndex');
        const { sendFreebieSaleNotificationEmail } = require('../utils/email');
        const User = require('../models/User');
        const Freebie = require('../models/Freebie');

        // Idempotency — skip if already exists
        const existingAccess = await FreebieAccess.findOne({ where: { userId, freebieId: contentId } });
        if (!existingAccess) {
          await FreebieAccess.create({
            userId,
            freebieId: contentId,
            purchaseReference: reference,
            amountPaid: amount,
            currency,
            couponId: couponId || null
          }, { transaction });
        }

        // Fire-and-forget sale email to creator after commit
        transaction.afterCommit(async () => {
          try {
            const freebie = await Freebie.findByPk(contentId, {
              include: [{ model: User, as: 'creator', attributes: ['email', 'firstname', 'lastname'] }]
            });
            const buyer = await User.findByPk(userId, { attributes: ['firstname', 'lastname'] });
            if (freebie && buyer) {
              await sendFreebieSaleNotificationEmail(
                freebie.creator.email,
                `${freebie.creator.firstname} ${freebie.creator.lastname}`,
                freebie.title,
                `${buyer.firstname} ${buyer.lastname}`,
                amount,
                currency,
                new Date()
              );
            }
          } catch (emailErr) {
            console.error('[Payment Routing] Freebie sale email failed:', emailErr.message);
          }
        });
      }

      // Resolve referral commission upfront (before crediting creator) so we can
      // deduct it from creator earnings at source. Skip if a coupon partner already applies.
      let referralInfo = null;
      if (!couponPartnerUserId) {
        referralInfo = await this._resolveReferralCommission({
          buyerUserId: userId,
          purchaseId: purchase.id,
          amount
        });
      }

      // Get content creator and credit their multi-currency wallet (skip for courses)
      if (contentType !== 'special_course') {
        const creatorId = await this.getContentCreatorId(contentType, contentId);
        
        if (creatorId) {
          try {
            // Determine creator earnings:
            // 1. Deduct coupon partner commission if applicable
            // 2. Deduct referral commission if applicable (Option A: deducted at source)
            let creatorEarnings = amount;

            if (partnerCommission) {
              creatorEarnings = amount - partnerCommission;
              console.log(`[Payment Routing] Coupon commission applied: Creator earnings = ${amount} - ${partnerCommission} = ${creatorEarnings} ${currency}`);
            }

            if (referralInfo) {
              creatorEarnings = creatorEarnings - referralInfo.commissionAmount;
              console.log(`[Payment Routing] Referral commission applied: Creator earnings reduced by ${referralInfo.commissionAmount} ${currency} → ${creatorEarnings} ${currency}`);
            }
            
            // Credit creator's wallet with earnings after all commissions
            await this.walletService.creditWallet({
              userId: creatorId,
              currency,
              amount: creatorEarnings,
              reference,
              description: `Earnings from ${contentType} purchase`,
              metadata: {
                purchaseId: purchase.id,
                buyerUserId: userId,
                contentType,
                contentId,
                gateway,
                couponApplied: couponId ? true : false,
                referralCommissionDeducted: referralInfo ? referralInfo.commissionAmount : 0
              }
            });

            console.log(`[Payment Routing] Credited ${creatorEarnings} ${currency} to creator ${creatorId}'s wallet`);
            
            // Credit coupon partner commission if applicable
            if (partnerCommission && couponPartnerUserId) {
              try {
                await this.walletService.creditWallet({
                  userId: couponPartnerUserId,
                  currency,
                  amount: partnerCommission,
                  reference: `PARTNER-${reference}`,
                  description: `Partner commission from ${contentType} purchase`,
                  metadata: {
                    purchaseId: purchase.id,
                    buyerUserId: userId,
                    contentType,
                    contentId,
                    gateway,
                    creatorId
                  }
                });
                console.log(`[Payment Routing] Credited ${partnerCommission} ${currency} coupon partner commission to user ${couponPartnerUserId}`);
              } catch (partnerError) {
                console.error(`[Payment Routing] Failed to credit coupon partner commission:`, partnerError.message);
              }
            }

            // Credit referral partner commission if applicable
            if (referralInfo) {
              try {
                const User = require('../models/User');
                const buyer = await User.findByPk(userId, { attributes: ['firstname', 'lastname'] });
                await this.walletService.creditWallet({
                  userId: referralInfo.partnerUserId,
                  currency,
                  amount: referralInfo.commissionAmount,
                  reference: `REFERRAL-${purchase.id}`,
                  description: `Referral commission - ${buyer ? buyer.firstname + ' ' + buyer.lastname : userId}`,
                  metadata: {
                    purchaseId: purchase.id,
                    creatorUserId: userId,
                    contentType,
                    contentId,
                    creatorId
                  }
                });
                console.log(`[Payment Routing] Credited ${referralInfo.commissionAmount} ${currency} referral commission to partner ${referralInfo.partnerUserId}`);

                // Record the commission
                await this._recordReferralCommission({
                  buyerUserId: userId,
                  purchaseId: purchase.id,
                  amount,
                  currency,
                  contentType,
                  contentId,
                  commissionAmount: referralInfo.commissionAmount,
                  commissionPercent: referralInfo.commissionPercent,
                  partnerUserId: referralInfo.partnerUserId,
                  userReferral: referralInfo.userReferral
                });
              } catch (referralError) {
                console.error(`[Payment Routing] Failed to credit referral commission:`, referralError.message);
              }
            }
          } catch (walletError) {
            console.error(`[Payment Routing] Failed to credit wallet for creator ${creatorId}:`, walletError.message);
            
            // If wallet doesn't exist, try to create it and retry
            if (walletError.message && walletError.message.includes('Wallet not found')) {
              console.log(`[Payment Routing] Attempting to create wallet for creator ${creatorId}...`);
              
              try {
                const { getOrCreateWallet } = require('./walletService');
                await getOrCreateWallet(creatorId, currency);
                
                let creatorEarnings = amount;
                if (partnerCommission) creatorEarnings = amount - partnerCommission;
                if (referralInfo) creatorEarnings = creatorEarnings - referralInfo.commissionAmount;
                
                await this.walletService.creditWallet({
                  userId: creatorId,
                  currency,
                  amount: creatorEarnings,
                  reference,
                  description: `Earnings from ${contentType} purchase`,
                  metadata: {
                    purchaseId: purchase.id,
                    buyerUserId: userId,
                    contentType,
                    contentId,
                    gateway,
                    couponApplied: couponId ? true : false
                  }
                });
                
                console.log(`[Payment Routing] ✅ Wallet created and credited ${creatorEarnings} ${currency} to creator ${creatorId}`);
              } catch (retryError) {
                console.error(`[Payment Routing] ❌ Failed to create wallet and credit creator ${creatorId}:`, retryError.message);
              }
            } else {
              console.error(`[Payment Routing] ❌ Wallet credit error (non-critical):`, walletError);
            }
          }
        }
      } else {
        console.log(`[Payment Routing] Course purchase - no individual creator to credit`);
      }

      await transaction.commit();

      return {
        success: true,
        purchase,
        currency,
        gateway,
        message: 'Payment processed successfully'
      };

    } catch (error) {
      await transaction.rollback();
      console.error('[Payment Routing] Process payment error:', error);
      throw error;
    }
  }

  /**
   * Get content details (price, currency, title)
   */
  async getContentDetails(contentType, contentId) {
    try {
      if (contentType === 'video') {
        return await Video.findByPk(contentId, {
          attributes: ['id', 'title', 'price', 'currency', 'userId']
        });
      } else if (contentType === 'live_class') {
        return await LiveClass.findByPk(contentId, {
          attributes: ['id', 'title', 'price', 'currency', 'userId']
        });
      } else if (contentType === 'live_series') {
        const { LiveSeries } = require('../models/liveSeriesIndex');
        return await LiveSeries.findByPk(contentId, {
          attributes: ['id', 'title', 'price', 'currency', 'userId']
        });
      } else if (contentType === 'freebie') {
        const Freebie = require('../models/Freebie');
        return await Freebie.findByPk(contentId, {
          attributes: ['id', 'title', 'price', 'currency', 'userId']
        });
      } else if (contentType === 'course') {        // ✅ For monthly/yearly access, contentId is null (all courses)
        if (!contentId) {
          // Monthly or yearly all-access pass
          return {
            id: null,
            title: 'All-Access Pass',
            price: null,  // Will be set from metadata.finalPrice
            currency: null,  // Will be set from forceCurrency
            userId: null
          };
        }
        
        // For individual course purchases
        const Course = require('../models/Course');
        const course = await Course.findByPk(contentId, {
          attributes: ['id', 'name']  // ✅ REMOVED: priceUsd, priceNgn (now in .env)
        });
        
        if (course) {
          // ✅ For courses, pricing is now managed by CoursePricingService
          // The price will be passed in metadata.finalPrice by the course controller
          return {
            id: course.id,
            title: course.name,
            // ✅ REMOVED: priceUsd, priceNgn fields
            // Price is now passed via metadata.finalPrice
            price: null,  // Will be set from metadata
            currency: null,  // Will be set from forceCurrency
            userId: null // Courses don't have individual creators
          };
        }
      }
      return null;
    } catch (error) {
      console.error('[Payment Routing] Get content details error:', error);
      throw error;
    }
  }

  /**
   * Get content creator ID
   */
  async getContentCreatorId(contentType, contentId) {
    try {
      const content = await this.getContentDetails(contentType, contentId);
      return content?.userId || null;
    } catch (error) {
      console.error('[Payment Routing] Get creator ID error:', error);
      return null;
    }
  }

  /**
   * Get content currency (from content or default)
   */
  async getContentCurrency(contentType, contentId) {
    try {
      const content = await this.getContentDetails(contentType, contentId);
      return content?.currency || this.getDefaultCurrencyForContent(content);
    } catch (error) {
      console.error('[Payment Routing] Get content currency error:', error);
      return 'NGN'; // Default fallback
    }
  }

  /**
   * Get default currency for content (can be enhanced with business logic)
   */
  getDefaultCurrencyForContent(content) {
    // Default business logic: NGN for local content, USD for international
    // This can be enhanced based on creator location, content settings, etc.
    return 'NGN';
  }

  /**
   * Validate no duplicate purchase exists
   */
  async validateNoDuplicatePurchase(userId, contentType, contentId) {
    // For freebies, check FreebieAccess table
    if (contentType === 'freebie') {
      const { FreebieAccess } = require('../models/freebieIndex');
      const existingAccess = await FreebieAccess.findOne({
        where: { userId, freebieId: contentId }
      });
      if (existingAccess) {
        throw new Error('You have already purchased this content');
      }
      return;
    }

    const existingPurchase = await Purchase.findOne({
      where: {
        userId,
        contentType,
        contentId,
        paymentStatus: 'completed'
      }
    });

    if (existingPurchase) {
      throw new Error('You have already purchased this content');
    }
  }

  /**
   * Get supported currencies
   */
  getSupportedCurrencies() {
    return Object.keys(this.gatewayRouting);
  }

  /**
   * Get gateway for currency
   */
  getGatewayForCurrency(currency) {
    this.walletService.validateCurrency(currency);
    return this.gatewayRouting[currency]?.gateway;
  }

  /**
   * Validate currency-gateway pairing
   */
  validateCurrencyGatewayPairing(currency, gateway) {
    return this.walletService.validateCurrencyGatewayPairing(currency, gateway);
  }

  /**
   * Process referral commission for a successful purchase.
   * Never throws — errors are caught and logged so the purchase is never rolled back.
   */
  /**
   * Resolve referral commission details for a purchase WITHOUT doing any wallet ops.
   * Returns { commissionAmount, commissionPercent, partnerUserId, userReferral } or null.
   * Never throws.
   */
  async _resolveReferralCommission({ buyerUserId, purchaseId, amount }) {
    try {
      const UserReferral = require('../models/UserReferral');
      const ReferralCode = require('../models/ReferralCode');
      const ReferralCommission = require('../models/ReferralCommission');

      // Idempotency — already recorded
      const existing = await ReferralCommission.findOne({ where: { purchaseId } });
      if (existing) return null;

      // Load UserReferral for the buyer (the referred creator)
      const userReferral = await UserReferral.findOne({
        where: { creatorUserId: buyerUserId, commissionActive: true }
      });
      if (!userReferral) return null;

      // Check code is still active and not expired
      const referralCode = await ReferralCode.findByPk(userReferral.referralCodeId);
      if (!referralCode || new Date(referralCode.expiresAt) <= new Date()) return null;

      const commissionPercent = parseFloat(referralCode.commissionPercent);
      const commissionAmount = Math.round((commissionPercent / 100) * amount * 100) / 100;

      return {
        commissionAmount,
        commissionPercent,
        partnerUserId: userReferral.partnerUserId,
        userReferral,
        referralCode
      };
    } catch (err) {
      console.error('[PaymentRouting] _resolveReferralCommission error (non-critical):', err.message);
      return null;
    }
  }

  /**
   * Record the referral commission after wallets have been credited/debited.
   * Never throws.
   */
  async _recordReferralCommission({ buyerUserId, purchaseId, amount, currency, contentType, contentId, commissionAmount, commissionPercent, partnerUserId, userReferral }) {
    try {
      const ReferralCommission = require('../models/ReferralCommission');
      const ReferralCode = require('../models/ReferralCode');

      await ReferralCommission.create({
        referralCode: userReferral.referralCode,
        referrerUserId: partnerUserId,
        refereeUserId: buyerUserId,
        purchaseId,
        commissionAmount,
        commissionPercent,
        purchaseAmount: amount,
        currency,
        contentType,
        contentId: contentId || null,
        purchasedAt: new Date()
      });

      // Keep total_earnings on the referral_codes row in sync
      await ReferralCode.increment('totalEarnings', {
        by: commissionAmount,
        where: { id: userReferral.referralCodeId }
      });

      console.log(`[PaymentRouting] Referral commission recorded: ${commissionAmount} ${currency} to partner ${partnerUserId}`);
    } catch (err) {
      console.error('[PaymentRouting] _recordReferralCommission error (non-critical):', err.message);
    }
  }
}

module.exports = PaymentRoutingService;