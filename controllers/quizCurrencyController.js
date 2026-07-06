const quizWalletService = require('../services/quizWalletService');

/**
 * Quiz Currency Controller
 * 
 * Handles currency operations (Option B - Unified Bridge):
 * - Purchase Chuta from platform wallet
 * - Withdraw Chuta to platform wallet
 */

/**
 * Purchase Chuta from platform wallet
 * POST /api/quiz/currency/purchase
 * Body: { amount: number, currency: 'USD' | 'NGN' }
 */
exports.purchaseCurrency = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, currency = 'USD' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    if (!['USD', 'NGN'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Currency must be USD or NGN'
      });
    }

    const result = await quizWalletService.purchaseCurrency(userId, amount, currency);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Currency Controller] Purchase error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to purchase currency'
    });
  }
};

/**
 * Withdraw Chuta to platform wallet
 * POST /api/quiz/currency/withdraw
 * Body: { chutaAmount: number, currency: 'USD' | 'NGN' }
 */
exports.withdrawFunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chutaAmount, currency = 'USD' } = req.body;

    if (!chutaAmount || chutaAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Chuta amount'
      });
    }

    if (!['USD', 'NGN'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Currency must be USD or NGN'
      });
    }

    const result = await quizWalletService.withdrawFunds(userId, chutaAmount, currency);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Currency Controller] Withdraw error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to withdraw funds'
    });
  }
};

module.exports = exports;
