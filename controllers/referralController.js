const referralService = require('../services/referralService');

/**
 * Referral Controller
 * Partner self-service endpoints.
 */

/**
 * GET /api/referral/my-code
 * Get the authenticated partner's referral code.
 */
exports.getMyCode = async (req, res) => {
  try {
    const data = await referralService.getPartnerReferralCode(req.user.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'No referral code found' });
    }
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[ReferralController] getMyCode error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/referral/my-stats
 * Get the authenticated partner's referral stats.
 */
exports.getMyStats = async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const data = await referralService.getPartnerStats(req.user.id, { limit, offset });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[ReferralController] getMyStats error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
