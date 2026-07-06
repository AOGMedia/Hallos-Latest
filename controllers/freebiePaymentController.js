const freebiePaymentService = require('../services/freebiePaymentService');

/**
 * FreebiePaymentController
 *
 * Thin HTTP layer for freebie purchase endpoints.
 * All business logic lives in freebiePaymentService.
 */

/**
 * Initiate purchase for a paid freebie
 * POST /api/freebies/:id/purchase
 */
exports.initiatePurchase = async (req, res) => {
  try {
    const freebieId = req.params.id;
    const userId = req.user.id;
    const { currency, couponCode } = req.body;

    if (!currency) {
      return res.status(400).json({
        success: false,
        message: 'currency is required (NGN or USD)'
      });
    }

    // Fetch user email from DB since JWT may not include it
    const User = require('../models/User');
    const user = await User.findByPk(userId, { attributes: ['email'] });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await freebiePaymentService.initiatePurchase({
      freebieId,
      userId,
      userEmail: user.email,
      currency: currency.toUpperCase(),
      couponCode
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[FreebiePaymentController] initiatePurchase error:', error);

    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to initiate purchase',
      ...(error.alreadyPurchased && { alreadyPurchased: true })
    });
  }
};

/**
 * Revoke access (admin — manual refund support)
 * DELETE /api/freebies/access/revoke
 */
exports.revokeAccess = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { freebieId, userId } = req.body;

    if (!freebieId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'freebieId and userId are required'
      });
    }

    const result = await freebiePaymentService.revokeAccess({
      freebieId,
      userId: parseInt(userId),
      adminId
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[FreebiePaymentController] revokeAccess error:', error);

    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to revoke access'
    });
  }
};

module.exports = exports;
