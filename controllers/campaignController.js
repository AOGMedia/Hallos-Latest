const { paystackClient } = require('../config/paystack');
const CampaignRegistration = require('../models/CampaignRegistration');

const CAMPAIGN_AMOUNT_NGN = 3000;        // ₦3,000
const CAMPAIGN_AMOUNT_KOBO = 300000;     // in kobo

/**
 * Register for the Hallos Fastrack Retreat campaign
 * POST /api/campaigns/register
 *
 * Body: { firstName, lastName, email, phoneNumber, location, talent, jobDescription, whatToLearn }
 * Returns: { authorizationUrl, reference } for Paystack redirect
 */
exports.registerForCampaign = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      location,
      talent,
      jobDescription,
      whatToLearn
    } = req.body;

    // Validate required fields
    const missing = [];
    if (!firstName)    missing.push('firstName');
    if (!lastName)     missing.push('lastName');
    if (!email)        missing.push('email');
    if (!phoneNumber)  missing.push('phoneNumber');
    if (!location)     missing.push('location');
    if (!talent)       missing.push('talent');

    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`
      });
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    // Prevent duplicate completed registrations on the same email
    const existingCompleted = await CampaignRegistration.findOne({
      where: { email: email.toLowerCase().trim(), paymentStatus: 'completed' }
    });

    if (existingCompleted) {
      return res.status(409).json({
        success: false,
        message: 'This email address has already registered and paid for the campaign.',
        alreadyRegistered: true
      });
    }

    // Generate a unique reference for this transaction
    const reference = `camp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Create a pending registration record before calling Paystack
    const registration = await CampaignRegistration.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      phoneNumber: phoneNumber.trim(),
      location: location.trim(),
      talent: talent.trim(),
      jobDescription: jobDescription ? jobDescription.trim() : null,
      whatToLearn: whatToLearn ? whatToLearn.trim() : null,
      paymentReference: reference,
      paymentStatus: 'pending',
      paymentGateway: 'paystack',
      amount: CAMPAIGN_AMOUNT_NGN,
      currency: 'NGN'
    });

    // Initialize Paystack transaction
    const paystackResponse = await paystackClient.post('/transaction/initialize', {
      email: registration.email,
      amount: CAMPAIGN_AMOUNT_KOBO,
      currency: 'NGN',
      reference,
      callback_url: `${process.env.CLIENT_URL}/campaign/success`,
      metadata: {
        type: 'campaign_registration',
        registrationId: registration.id,
        firstName: registration.firstName,
        lastName: registration.lastName,
        phoneNumber: registration.phoneNumber,
        location: registration.location,
        talent: registration.talent
      }
    });

    const { authorization_url, access_code } = paystackResponse.data.data;

    return res.status(200).json({
      success: true,
      message: 'Registration initiated. Complete your payment to confirm your spot.',
      authorizationUrl: authorization_url,
      accessCode: access_code,
      reference,
      registrationId: registration.id
    });
  } catch (error) {
    console.error('[Campaign] Register error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate campaign registration. Please try again.'
    });
  }
};

/**
 * Get all campaign registrations (admin only)
 * GET /api/campaigns/registrations
 * Query: ?status=completed&page=1&limit=50
 */
exports.getRegistrations = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status && ['pending', 'completed', 'failed'].includes(status)) {
      where.paymentStatus = status;
    }

    const result = await CampaignRegistration.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
      attributes: [
        'id', 'firstName', 'lastName', 'email', 'phoneNumber',
        'location', 'talent', 'jobDescription', 'whatToLearn',
        'paymentStatus', 'amount', 'currency', 'paymentReference',
        'emailSent', 'createdAt'
      ]
    });

    return res.status(200).json({
      success: true,
      total: result.count,
      page: parseInt(page),
      limit: parseInt(limit),
      registrations: result.rows
    });
  } catch (error) {
    console.error('[Campaign] Get registrations error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch registrations' });
  }
};
