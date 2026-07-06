const { paystackClient } = require('../config/paystack');
const { stripeClient } = require('../config/stripe');
const Purchase = require('../models/Purchase');
const Wallet = require('../models/Wallet');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');
const sequelize = require('../config/db');

/**
 * Initialize Paystack payment
 */
async function initializePaystackPayment({ userId, contentType, contentId, amount, currency, email }) {
  try {
    // Build custom fields array, excluding null contentId
    const customFields = [
      {
        display_name: 'Content Type',
        variable_name: 'content_type',
        value: contentType
      }
    ];
    
    // Only add Content ID field if contentId is not null
    if (contentId) {
      customFields.push({
        display_name: 'Content ID',
        variable_name: 'content_id',
        value: contentId
      });
    }
    
    const response = await paystackClient.post('/transaction/initialize', {
      email,
      amount: Math.round(amount * 100), // Paystack expects amount in kobo (smallest currency unit)
      currency: currency || 'NGN',
      metadata: {
        userId,
        contentType,
        contentId: contentId || null,  // Keep null in metadata for webhook
        custom_fields: customFields
      },
      callback_url: `${process.env.CLIENT_URL}/payments/verify`
    });

    return {
      success: true,
      authorizationUrl: response.data.data.authorization_url,
      accessCode: response.data.data.access_code,
      reference: response.data.data.reference
    };
  } catch (error) {
    console.error('Paystack initialization error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to initialize Paystack payment');
  }
}

/**
 * Initialize Stripe payment
 */
async function initializeStripePayment({ userId, contentType, contentId, amount, currency, email }) {
  try {
    // Get content details for description
    let contentTitle = 'Content Purchase';
    if (contentType === 'video') {
      const video = await Video.findByPk(contentId);
      contentTitle = video ? video.title : 'Video Purchase';
    } else if (contentType === 'live_class') {
      const liveClass = await LiveClass.findByPk(contentId);
      contentTitle = liveClass ? liveClass.title : 'Live Class Purchase';
    }

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency || 'usd',
            product_data: {
              name: contentTitle,
              description: `Purchase access to ${contentType.replace('_', ' ')}`
            },
            unit_amount: Math.round(amount * 100) // Stripe expects amount in cents
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
      client_reference_id: userId.toString(),
      metadata: {
        userId: userId.toString(),
        contentType,
        contentId: contentId || 'null',  // Stripe metadata doesn't accept null, use string
        email
      }
    });

    return {
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url,
      reference: session.id
    };
  } catch (error) {
    console.error('Stripe initialization error:', error.message);
    throw new Error(error.message || 'Failed to initialize Stripe payment');
  }
}

/**
 * Verify Paystack payment
 */
async function verifyPaystackPayment(reference) {
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
    console.error('Paystack verification error:', error.response?.data || error.message);
    throw new Error('Failed to verify Paystack payment');
  }
}

/**
 * Verify Stripe payment
 */
async function verifyStripePayment(sessionId) {
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
    console.error('Stripe verification error:', error.message);
    throw new Error('Failed to verify Stripe payment');
  }
}

/**
 * Process successful payment - Create purchase record and update wallet
 */
async function processSuccessfulPayment({ userId, contentType, contentId, amount, currency, reference, gateway }) {
  const transaction = await sequelize.transaction();
  
  try {
    console.log(`[Process Payment] Starting for user ${userId}, ${contentType} ${contentId}, amount: ${amount}`);

    // Check if purchase already exists (idempotency)
    const existingPurchase = await Purchase.findOne({
      where: { paymentReference: reference }
    });

    if (existingPurchase) {
      await transaction.rollback();
      console.log(`[Process Payment] Purchase already exists for reference: ${reference}`);
      return {
        success: true,
        purchase: existingPurchase,
        message: 'Purchase already processed'
      };
    }

    // Create purchase record
    const purchase = await Purchase.create({
      userId: parseInt(userId),
      contentType,
      contentId,
      amount: parseFloat(amount),
      currency: currency || 'NGN',
      paymentGateway: gateway,
      paymentReference: reference,
      paymentStatus: 'completed'
    }, { transaction });

    console.log(`[Process Payment] Purchase created with ID: ${purchase.id}`);

    // Get content creator ID
    let creatorId;
    if (contentType === 'video') {
      const video = await Video.findByPk(contentId);
      creatorId = video?.userId;
      console.log(`[Process Payment] Video creator ID: ${creatorId}`);
    } else if (contentType === 'live_class') {
      const liveClass = await LiveClass.findByPk(contentId);
      creatorId = liveClass?.userId;
      console.log(`[Process Payment] Live class creator ID: ${creatorId}`);
    }

    if (creatorId) {
      // Get or create wallet for creator
      let wallet = await Wallet.findOne({ where: { userId: creatorId } });
      
      if (!wallet) {
        wallet = await Wallet.create({
          userId: creatorId,
          totalEarnings: parseFloat(amount),
          withdrawnAmount: 0,
          pendingAmount: 0,
          currency: currency || 'NGN'
        }, { transaction });
        console.log(`[Process Payment] Wallet created for creator ${creatorId}`);
      } else {
        // Update wallet earnings
        wallet.totalEarnings = parseFloat(wallet.totalEarnings) + parseFloat(amount);
        await wallet.save({ transaction });
        console.log(`[Process Payment] Wallet updated for creator ${creatorId}, new total: ${wallet.totalEarnings}`);
      }
    } else {
      console.log(`[Process Payment] Warning: No creator found for ${contentType} ${contentId}`);
    }

    await transaction.commit();
    console.log(`[Process Payment] Transaction committed successfully for reference: ${reference}`);

    return {
      success: true,
      purchase,
      message: 'Payment processed successfully'
    };
  } catch (error) {
    await transaction.rollback();
    console.error('[Process Payment] Error:', error);
    throw error;
  }
}

module.exports = {
  initializePaystackPayment,
  initializeStripePayment,
  verifyPaystackPayment,
  verifyStripePayment,
  processSuccessfulPayment
};
