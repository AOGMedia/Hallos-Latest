const CurrencyWithdrawalService = require('../services/currencyWithdrawalService');

// Create singleton instance
const currencyWithdrawalService = new CurrencyWithdrawalService();

/**
 * Currency-Specific Withdrawal Controller
 * 
 * Handles currency-specific withdrawal operations:
 * - Fee calculations
 * - Bank validation
 * - Supported banks listing
 * - Withdrawal status checking
 */

/**
 * Calculate withdrawal fees for specific currency
 * POST /api/wallet/calculate-withdrawal-fees
 */
exports.calculateWithdrawalFees = async (req, res) => {
  try {
    const { amount, currency } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({
        success: false,
        message: 'Amount and currency are required'
      });
    }

    if (!['NGN', 'USD'].includes(currency.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported currency. Only NGN and USD are supported.'
      });
    }

    const feeCalculation = currencyWithdrawalService.calculateFees(
      parseFloat(amount),
      currency.toUpperCase()
    );

    return res.status(200).json({
      success: true,
      fees: feeCalculation
    });

  } catch (error) {
    console.error('[Currency Withdrawal Controller] Calculate fees error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate withdrawal fees'
    });
  }
};

/**
 * Get supported banks for currency
 * GET /api/wallet/supported-banks/:currency
 */
exports.getSupportedBanks = async (req, res) => {
  try {
    const { currency } = req.params;

    if (!currency || !['NGN', 'USD'].includes(currency.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Valid currency is required (NGN or USD)'
      });
    }

    const banks = await currencyWithdrawalService.getSupportedBanks(currency.toUpperCase());

    return res.status(200).json({
      success: true,
      currency: currency.toUpperCase(),
      banks: banks
    });

  } catch (error) {
    console.error('[Currency Withdrawal Controller] Get banks error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get supported banks'
    });
  }
};

/**
 * Validate bank account for specific currency
 * POST /api/wallet/validate-bank-account
 */
exports.validateBankAccount = async (req, res) => {
  try {
    const { currency, bankAccount } = req.body;

    if (!currency || !bankAccount) {
      return res.status(400).json({
        success: false,
        message: 'Currency and bank account details are required'
      });
    }

    if (!['NGN', 'USD'].includes(currency.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported currency. Only NGN and USD are supported.'
      });
    }

    let validation;
    if (currency.toUpperCase() === 'NGN') {
      validation = await currencyWithdrawalService.validateNigerianBankAccount(bankAccount);
    } else {
      validation = currencyWithdrawalService.validateInternationalBankAccount(bankAccount);
    }

    if (validation.valid) {
      return res.status(200).json({
        success: true,
        message: 'Bank account is valid',
        accountDetails: {
          accountName: validation.accountName,
          accountNumber: validation.accountNumber
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }

  } catch (error) {
    console.error('[Currency Withdrawal Controller] Validate bank error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to validate bank account'
    });
  }
};

/**
 * Get withdrawal limits for currency
 * GET /api/wallet/withdrawal-limits/:currency
 */
exports.getWithdrawalLimits = async (req, res) => {
  try {
    const { currency } = req.params;

    if (!currency || !['NGN', 'USD'].includes(currency.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Valid currency is required (NGN or USD)'
      });
    }

    const currencyUpper = currency.toUpperCase();
    const limits = currencyWithdrawalService.config.limits[currencyUpper];
    const fees = currencyUpper === 'NGN' 
      ? currencyWithdrawalService.config.paystack.fees
      : currencyWithdrawalService.config.stripe.fees;

    return res.status(200).json({
      success: true,
      currency: currencyUpper,
      limits: limits,
      fees: {
        percentage: fees.percentage,
        fixed: fees.fixed || 0,
        minimum: fees.minimum,
        cap: fees.cap || null
      }
    });

  } catch (error) {
    console.error('[Currency Withdrawal Controller] Get limits error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get withdrawal limits'
    });
  }
};

/**
 * Check withdrawal status
 * GET /api/wallet/withdrawal-status/:reference/:currency
 */
exports.checkWithdrawalStatus = async (req, res) => {
  try {
    const { reference, currency } = req.params;

    if (!reference || !currency) {
      return res.status(400).json({
        success: false,
        message: 'Reference and currency are required'
      });
    }

    if (!['NGN', 'USD'].includes(currency.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported currency. Only NGN and USD are supported.'
      });
    }

    const status = await currencyWithdrawalService.getWithdrawalStatus(
      reference,
      currency.toUpperCase()
    );

    return res.status(status.success ? 200 : 400).json(status);

  } catch (error) {
    console.error('[Currency Withdrawal Controller] Check status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check withdrawal status'
    });
  }
};

/**
 * Process currency-specific withdrawal
 * POST /api/wallet/process-currency-withdrawal
 */
exports.processCurrencyWithdrawal = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { amount, currency, bankAccount, reference } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!amount || !currency || !bankAccount) {
      return res.status(400).json({
        success: false,
        message: 'Amount, currency, and bank account are required'
      });
    }

    const withdrawalData = {
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      bankAccount,
      userId,
      reference: reference || `withdrawal_${Date.now()}_${userId}`
    };

    console.log(`[Currency Withdrawal Controller] Processing withdrawal for user ${userId}`);

    const result = await currencyWithdrawalService.processWithdrawal(withdrawalData);

    return res.status(result.success ? 200 : 400).json(result);

  } catch (error) {
    console.error('[Currency Withdrawal Controller] Process withdrawal error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal'
    });
  }
};

/**
 * Get currency withdrawal configuration
 * GET /api/wallet/currency-config
 */
exports.getCurrencyConfig = async (req, res) => {
  try {
    const config = {
      supportedCurrencies: ['NGN', 'USD'],
      limits: currencyWithdrawalService.config.limits,
      fees: {
        NGN: currencyWithdrawalService.config.paystack.fees,
        USD: currencyWithdrawalService.config.stripe.fees
      },
      gateways: {
        NGN: 'Paystack',
        USD: 'Stripe'
      }
    };

    return res.status(200).json({
      success: true,
      config
    });

  } catch (error) {
    console.error('[Currency Withdrawal Controller] Get config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get currency configuration'
    });
  }
};