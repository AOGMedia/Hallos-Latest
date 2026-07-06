const sequelize = require('../config/db');
const { Freebie, FreebieAccess } = require('../models/freebieIndex');
const User = require('../models/User');
const CouponService = require('./couponService');
const MultiCurrencyWalletService = require('./multiCurrencyWalletService');
const { paystackClient } = require('../config/paystack');
const { stripeClient } = require('../config/stripe');
const { sendFreebieSaleNotificationEmail } = require('../utils/email');

const couponService = new CouponService();
const walletService = new MultiCurrencyWalletService();

/**
 * FreebiePaymentService
 *
 * Handles the full payment lifecycle for paid freebies:
 * - initiatePurchase  → validate, apply coupon, call gateway, return auth URL
 * - verifyPurchase    → confirm with gateway, create FreebieAccess, credit wallet, email
 * - revokeAccess      → admin manual refund support
 */
class FreebiePaymentService {
  /**
   * Initiate a purchase for a paid freebie.
   *
   * @param {object} params
   * @param {string} params.freebieId
   * @param {number} params.userId
   * @param {string} params.userEmail
   * @param {string} params.currency  - 'NGN' | 'USD'
   * @param {string} [params.couponCode]
   * @returns {Promise<object>}
   */
  async initiatePurchase({ freebieId, userId, userEmail, currency, couponCode }) {
    // Load freebie
    const freebie = await Freebie.findByPk(freebieId);
    if (!freebie) {
      const err = new Error('Freebie not found');
      err.statusCode = 404;
      throw err;
    }

    // Must be a paid freebie
    if (parseFloat(freebie.price) === 0) {
      const err = new Error('This freebie is free — no payment required');
      err.statusCode = 400;
      throw err;
    }

    // Creator cannot buy their own freebie
    if (freebie.userId === userId) {
      const err = new Error('You cannot purchase your own freebie');
      err.statusCode = 403;
      throw err;
    }

    // Already purchased
    const existing = await FreebieAccess.findOne({ where: { userId, freebieId } });
    if (existing) {
      const err = new Error('You have already purchased this freebie');
      err.statusCode = 409;
      err.alreadyPurchased = true;
      throw err;
    }

    const originalPrice = parseFloat(freebie.price);
    const baseCurrency = freebie.currency || 'NGN';
    let finalPrice = originalPrice;
    let couponId = null;
    let couponApplied = false;

    // Convert price if buyer's currency differs from freebie's base currency
    const CurrencyConversionService = require('./currencyConversionService');
    const conversionService = new CurrencyConversionService();
    let convertedPrice = originalPrice;
    if (currency !== baseCurrency) {
      convertedPrice = conversionService.convert(originalPrice, baseCurrency, currency);
      console.log(`[FreebiePayment] Currency conversion: ${originalPrice} ${baseCurrency} → ${convertedPrice} ${currency}`);
    }
    finalPrice = convertedPrice;

    // Apply coupon if provided
    if (couponCode) {
      const validation = await couponService.validateCoupon(
        couponCode,
        'freebie',
        freebieId,
        userId,
        currency  // pass buyer's currency so coupon calculates discount in correct currency
      );

      if (!validation.valid) {
        const err = new Error(validation.error || 'Invalid coupon code');
        err.statusCode = 400;
        throw err;
      }

      // Coupon must belong to the freebie's creator
      if (validation.coupon.type === 'creator' && validation.coupon.creatorId !== freebie.userId) {
        const err = new Error('You can only apply coupons created by this content\'s creator');
        err.statusCode = 400;
        throw err;
      }

      finalPrice = validation.finalPrice; // already in buyer's currency from couponService
      couponId = validation.coupon.id;
      couponApplied = true;
    }

    // Route to correct gateway
    if (currency === 'NGN') {
      return await this._initiatePaystack({ freebieId, userId, userEmail, originalPrice: convertedPrice, finalPrice, currency, couponId, couponApplied });
    } else if (currency === 'USD') {
      // Stripe minimum charge is $0.50 USD
      const STRIPE_MIN_USD = 0.50;
      if (finalPrice < STRIPE_MIN_USD) {
        const err = new Error(`The minimum purchase amount for USD is $${STRIPE_MIN_USD}. This item's converted price ($${finalPrice.toFixed(2)}) is below the minimum. Please purchase in NGN instead.`);
        err.statusCode = 400;
        throw err;
      }
      return await this._initiateStripe({ freebieId, userId, userEmail, originalPrice: convertedPrice, finalPrice, currency, couponId, couponApplied });
    } else {
      const err = new Error('Unsupported currency. Use NGN or USD');
      err.statusCode = 400;
      throw err;
    }
  }

  async _initiatePaystack({ freebieId, userId, userEmail, originalPrice, finalPrice, currency, couponId, couponApplied }) {
    const reference = `freebie_${freebieId}_${userId}_${Date.now()}`;

    const response = await paystackClient.post('/transaction/initialize', {
      email: userEmail,
      amount: Math.round(finalPrice * 100), // kobo
      currency: currency.toUpperCase(),
      metadata: {
        userId: userId.toString(),
        contentType: 'freebie',
        contentId: freebieId,
        couponId: couponId ? couponId.toString() : null,
        originalPrice: originalPrice ? originalPrice.toString() : null,
        discountAmount: couponApplied ? (originalPrice - finalPrice).toString() : null,
        contentType_label: 'freebie'
      },
      callback_url: `${process.env.CLIENT_URL}/payments/verify`
    });

    if (!response.data.status) {
      throw new Error('Failed to initialize Paystack payment');
    }

    return {
      success: true,
      gateway: 'paystack',
      currency,
      originalPrice,
      finalPrice,
      couponApplied,
      data: {
        authorizationUrl: response.data.data.authorization_url,
        accessCode: response.data.data.access_code,
        reference: response.data.data.reference
      }
    };
  }

  async _initiateStripe({ freebieId, userId, userEmail, originalPrice, finalPrice, currency, couponId, couponApplied }) {
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: userEmail,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(finalPrice * 100), // cents
          product_data: { name: 'Freebie Purchase' }
        },
        quantity: 1
      }],
      metadata: {
        userId: userId.toString(),
        contentType: 'freebie',
        contentId: freebieId,
        couponId: couponId ? couponId.toString() : '',
        originalPrice: originalPrice ? originalPrice.toString() : '',
        discountAmount: couponApplied ? (originalPrice - finalPrice).toString() : ''
      },
      success_url: `${process.env.CLIENT_URL}/payments/verify?session_id={CHECKOUT_SESSION_ID}&contentType=freebie&contentId=${freebieId}`,
      cancel_url: `${process.env.CLIENT_URL}/payments/verify?cancelled=true`
    });

    return {
      success: true,
      gateway: 'stripe',
      currency,
      originalPrice,
      finalPrice,
      couponApplied,
      data: {
        sessionId: session.id,
        sessionUrl: session.url,
        reference: session.id
      }
    };
  }

  /**
   * Verify a payment and grant access.
   *
   * @param {object} params
   * @param {string} params.freebieId
   * @param {number} params.userId
   * @param {string} params.paymentReference
   * @param {string} params.currency  - 'NGN' | 'USD'
   * @returns {Promise<object>}
   */
  async verifyPurchase({ freebieId, userId, paymentReference, currency }) {
    const freebie = await Freebie.findByPk(freebieId, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'email', 'firstname', 'lastname'] }]
    });

    if (!freebie) {
      const err = new Error('Freebie not found');
      err.statusCode = 404;
      throw err;
    }

    // Idempotency — already processed
    const existing = await FreebieAccess.findOne({ where: { userId, freebieId } });
    if (existing) {
      return {
        success: true,
        alreadyProcessed: true,
        freebieAccess: existing
      };
    }

    // Verify with gateway
    let amountPaid;
    let couponId = null;

    if (currency === 'NGN') {
      const result = await this._verifyPaystack(paymentReference);
      amountPaid = result.amountPaid;
      couponId = result.metadata?.couponId || null;
    } else if (currency === 'USD') {
      const result = await this._verifyStripe(paymentReference);
      amountPaid = result.amountPaid;
      couponId = result.metadata?.couponId || null;
    } else {
      const err = new Error('Unsupported currency');
      err.statusCode = 400;
      throw err;
    }

    // Atomic: create access record + credit creator wallet
    let freebieAccess;
    await sequelize.transaction(async (t) => {
      freebieAccess = await FreebieAccess.create({
        userId,
        freebieId,
        purchaseReference: paymentReference,
        amountPaid,
        currency,
        couponId: couponId || null
      }, { transaction: t });

      // Credit creator wallet — full amount, no platform fee at purchase time
      await walletService.creditWallet({
        userId: freebie.userId,
        currency,
        amount: amountPaid,
        reference: `freebie_sale_${freebieAccess.id}`,
        description: `Sale: ${freebie.title}`,
        metadata: { freebieId, buyerId: userId, contentType: 'freebie' }
      });

      // Record coupon usage if applicable
      if (couponId) {
        await couponService.recordCouponUsage({
          couponId,
          userId,
          purchaseId: freebieAccess.id,
          originalPrice: parseFloat(freebie.price),
          discountAmount: parseFloat(freebie.price) - amountPaid,
          finalPrice: amountPaid,
          contentType: 'freebie',
          contentId: freebieId,
          currency
        }, t);
      }
    });

    // Fire-and-forget: sale notification to creator
    const buyer = await User.findByPk(userId, { attributes: ['firstname', 'lastname'] });
    try {
      await sendFreebieSaleNotificationEmail(
        freebie.creator.email,
        `${freebie.creator.firstname} ${freebie.creator.lastname}`,
        freebie.title,
        `${buyer.firstname} ${buyer.lastname}`,
        amountPaid,
        currency,
        new Date()
      );
    } catch (emailErr) {
      console.error('[FreebiePaymentService] Sale notification email failed:', emailErr.message);
    }

    return {
      success: true,
      alreadyProcessed: false,
      message: 'Purchase verified. You now have full access.',
      freebieAccess
    };
  }

  async _verifyPaystack(reference) {
    const response = await paystackClient.get(`/transaction/verify/${reference}`);

    if (!response.data.status || response.data.data.status !== 'success') {
      const err = new Error('Payment not successful');
      err.statusCode = 400;
      throw err;
    }

    return {
      amountPaid: response.data.data.amount / 100, // kobo → naira
      metadata: response.data.data.metadata || {}
    };
  }

  async _verifyStripe(sessionId) {
    const session = await stripeClient.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      const err = new Error('Payment not successful');
      err.statusCode = 400;
      throw err;
    }

    return {
      amountPaid: session.amount_total / 100, // cents → dollars
      metadata: session.metadata || {}
    };
  }

  /**
   * Revoke access (admin manual refund support).
   *
   * @param {object} params
   * @param {string} params.freebieId
   * @param {number} params.userId
   * @param {number} params.adminId
   * @returns {Promise<object>}
   */
  async revokeAccess({ freebieId, userId, adminId }) {
    const access = await FreebieAccess.findOne({ where: { freebieId, userId } });

    if (!access) {
      const err = new Error('FreebieAccess record not found');
      err.statusCode = 404;
      throw err;
    }

    await access.destroy();

    console.log(`[FreebiePaymentService] Access revoked for user ${userId} on freebie ${freebieId} by admin ${adminId}`);

    return {
      success: true,
      message: 'Access revoked successfully.'
    };
  }
}

module.exports = new FreebiePaymentService();
