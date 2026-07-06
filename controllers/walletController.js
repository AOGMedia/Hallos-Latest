const {
  getAvailableBalance,
  getMultiCurrencyBalances,
  getEarningsBreakdown,
  getCreatorPurchases,
  releaseLockedAmount
} = require('../services/walletService');
const {
  calculatePayoutFees,
  initiateWithdrawal,
  processPaystackPayout,
  processStripePayout,
  getNigerianBanks,
  resolveAccountNumber
} = require('../services/payoutService');
const Payout = require('../models/Payout');
const User = require('../models/User');
const { sendWithdrawalConfirmationEmail } = require('../utils/email');

// Multi-Currency Services
const MultiCurrencyWalletService = require('../services/multiCurrencyWalletService');
const MultiCurrencyBalanceService = require('../services/multiCurrencyBalanceService');

// Initialize multi-currency services
const multiCurrencyWalletService = new MultiCurrencyWalletService();
const multiCurrencyBalanceService = new MultiCurrencyBalanceService();

/**
 * Get wallet balance (supports multi-currency)
 * GET /api/wallet/balance?currency=NGN
 */
exports.getWalletBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.query;

    if (currency && ['NGN', 'USD'].includes(currency)) {
      // Get specific currency balance
      const balance = await getAvailableBalance(userId, currency);
      return res.status(200).json({
        success: true,
        balance
      });
    } else {
      // Get all currency balances
      const balances = await getMultiCurrencyBalances(userId);
      return res.status(200).json({
        success: true,
        balances
      });
    }
  } catch (error) {
    console.error('Get wallet balance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet balance'
    });
  }
};

/**
 * Get earnings breakdown
 * GET /api/wallet/earnings
 */
exports.getEarnings = async (req, res) => {
  try {
    const userId = req.user.id;

    const earnings = await getEarningsBreakdown(userId);

    return res.status(200).json({
      success: true,
      earnings
    });
  } catch (error) {
    console.error('Get earnings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings breakdown'
    });
  }
};

/**
 * Get creator sales (list of students who purchased content)
 * GET /api/wallet/sales
 */
exports.getCreatorSales = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0, contentType } = req.query;

    const sales = await getCreatorPurchases(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      contentType
    });

    return res.status(200).json({
      success: true,
      sales
    });
  } catch (error) {
    console.error('Get creator sales error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch sales data'
    });
  }
};

module.exports = exports;

/**
 * Initiate withdrawal (enhanced with currency support)
 * POST /api/wallet/withdraw
 */
exports.initiateWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      amount, 
      bankName,     // For USD/international banks
      bankCode,     // For NGN/Nigerian banks  
      accountNumber, 
      accountName, 
      gateway = 'paystack',
      currency = 'NGN' 
    } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal amount'
      });
    }

    if (!['NGN', 'USD'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid currency. Supported currencies: NGN, USD'
      });
    }

    // Validate gateway-currency pairing
    if (currency === 'NGN' && gateway !== 'paystack') {
      return res.status(400).json({
        success: false,
        message: 'NGN withdrawals must use Paystack gateway'
      });
    }

    if (currency === 'USD' && gateway !== 'stripe') {
      return res.status(400).json({
        success: false,
        message: 'USD withdrawals must use Stripe gateway'
      });
    }

    // Validate bank details based on currency
    if (currency === 'NGN') {
      // For NGN, we need bankCode and account details
      if (!bankCode || !accountNumber || !accountName) {
        return res.status(400).json({
          success: false,
          message: 'Bank code, account number, and account name are required for NGN withdrawals'
        });
      }
    } else if (currency === 'USD') {
      // For USD, we need bankName and account details
      if (!bankName || !accountNumber || !accountName) {
        return res.status(400).json({
          success: false,
          message: 'Bank name, account number, and account name are required for USD withdrawals'
        });
      }
    }

    // Check available balance for specific currency
    const balance = await getAvailableBalance(userId, currency);
    
    if (balance.availableBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${currency} balance`,
        availableBalance: balance.availableBalance,
        requestedAmount: amount,
        currency
      });
    }

    // Calculate fees
    const fees = calculatePayoutFees(amount, gateway);

    // Prepare bank details based on currency
    const bankDetails = currency === 'NGN' 
      ? { bankCode, accountNumber, accountName }
      : { bankName, accountNumber, accountName };

    // Track whether funds were locked
    let fundsLocked = false;
    let payout = null;

    try {
      // Initiate withdrawal with currency (this locks the funds)
      payout = await initiateWithdrawal({
        userId,
        amount,
        currency,
        bankDetails,
        gateway
      });

      // If we reach here, funds are locked
      fundsLocked = true;

      // Process payout based on gateway
      let result;
      if (gateway === 'paystack') {
        result = await processPaystackPayout(payout.id);
      } else if (gateway === 'stripe') {
        result = await processStripePayout(payout.id);
      }

      return res.status(200).json({
        success: true,
        message: 'Withdrawal initiated successfully',
        payout: result.payout,
        fees,
        currency
      });
    } catch (processingError) {
      // Only release funds if they were actually locked
      if (fundsLocked) {
        try {
          await releaseLockedAmount(userId, amount, currency);
          console.log(`[Withdrawal] Released locked funds for user ${userId}: ${amount} ${currency}`);
        } catch (releaseError) {
          console.error('[Withdrawal] Failed to release locked funds:', releaseError);
          // Log but don't throw - the main error is more important
        }
      }
      
      return res.status(500).json({
        success: false,
        message: processingError.message || 'Failed to process withdrawal',
        payout,
        currency
      });
    }
  } catch (error) {
    console.error('Initiate withdrawal error:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate withdrawal'
    });
  }
};

/**
 * Get withdrawal history
 * GET /api/wallet/withdrawals
 */
exports.getWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0, status } = req.query;

    const whereClause = { userId };
    
    if (status && ['pending', 'processing', 'completed', 'failed'].includes(status)) {
      whereClause.status = status;
    }

    const payouts = await Payout.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json({
      success: true,
      total: payouts.count,
      withdrawals: payouts.rows,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawal history'
    });
  }
};

/**
 * Get list of Nigerian banks
 * GET /api/wallet/banks
 */
exports.getBanks = async (req, res) => {
  try {
    const banks = await getNigerianBanks();

    return res.status(200).json({
      success: true,
      banks
    });
  } catch (error) {
    console.error('Get banks error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch bank list'
    });
  }
};

/**
 * Calculate withdrawal fees (preview)
 * POST /api/wallet/calculate-fees
 */
exports.calculateFees = async (req, res) => {
  try {
    const { amount, gateway = 'paystack' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    const fees = calculatePayoutFees(amount, gateway);

    return res.status(200).json({
      success: true,
      fees
    });
  } catch (error) {
    console.error('Calculate fees error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate fees'
    });
  }
};

/**
 * Test Paystack API connectivity
 * GET /api/wallet/test-paystack
 */
exports.testPaystack = async (req, res) => {
  try {
    const { paystackClient } = require('../config/paystack');
    
    // Simple test - get banks list
    const response = await paystackClient.get('/bank?currency=NGN&perPage=5');
    
    return res.status(200).json({
      success: true,
      message: 'Paystack API is working',
      sampleBanks: response.data.data.slice(0, 3),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Paystack test error:', error.response?.data || error.message);
    
    return res.status(500).json({
      success: false,
      message: 'Paystack API is not responding',
      error: error.response?.data || error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Resolve account number to get account name
 * POST /api/wallet/resolve-account
 */
exports.resolveAccount = async (req, res) => {
  try {
    const { accountNumber, bankCode, fallbackMode = false } = req.body;

    // Validate input
    if (!accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: 'Account number and bank code are required'
      });
    }

    // Validate account number format (Nigerian account numbers are 10 digits)
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Account number must be 10 digits'
      });
    }

    // If fallback mode, skip Paystack and return basic info
    if (fallbackMode) {
      const { getNigerianBanks } = require('../services/payoutService');
      try {
        const banks = await getNigerianBanks();
        const bank = banks.find(b => b.code === bankCode);
        
        return res.status(200).json({
          success: true,
          data: {
            accountNumber,
            accountName: null, // User will need to enter manually
            bankCode,
            bankName: bank ? bank.name : null,
            fallbackMode: true,
            message: 'Account verification temporarily unavailable. Please verify account details manually.'
          }
        });
      } catch (fallbackError) {
        return res.status(500).json({
          success: false,
          message: 'Service temporarily unavailable'
        });
      }
    }

    const accountDetails = await resolveAccountNumber(accountNumber, bankCode);

    return res.status(200).json({
      success: true,
      data: accountDetails
    });
  } catch (error) {
    console.error('Resolve account error:', error);
    
    // Handle specific Paystack errors
    if (error.message.includes('Could not resolve account name')) {
      return res.status(404).json({
        success: false,
        message: 'Account not found. Please verify the account number and bank code.',
        fallbackSuggestion: 'Try using fallbackMode: true in request body to proceed manually'
      });
    }

    if (error.message.includes('Invalid bank code')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bank code provided'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to resolve account details. Paystack API may be temporarily unavailable.',
      debug: error.message,
      fallbackSuggestion: 'Try using fallbackMode: true in request body to proceed manually'
    });
  }
};

/**
 * Get transaction history
 * GET /api/wallet/transactions
 */
exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      transactionType, 
      startDate, 
      endDate, 
      limit = 50, 
      offset = 0 
    } = req.query;

    const { getTransactionHistory } = require('../services/transactionService');

    const result = await getTransactionHistory({
      userId,
      transactionType,
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction history'
    });
  }
};

/**
 * Get transaction statistics
 * GET /api/wallet/transaction-stats
 */
exports.getTransactionStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const { getTransactionStats } = require('../services/transactionService');

    const stats = await getTransactionStats(userId);

    return res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get transaction stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction statistics'
    });
  }
};

/**
 * Export transactions to CSV
 * GET /api/wallet/export-transactions
 */
exports.exportTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { transactionType, startDate, endDate } = req.query;

    const { exportTransactionsToCSV } = require('../services/transactionService');

    const csv = await exportTransactionsToCSV({
      userId,
      transactionType,
      startDate,
      endDate
    });

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=transactions_${Date.now()}.csv`);

    return res.status(200).send(csv);
  } catch (error) {
    console.error('Export transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to export transactions'
    });
  }
};

// ===== MULTI-CURRENCY WALLET FUNCTIONS (New) =====
// These functions provide enhanced multi-currency functionality
// while maintaining backward compatibility

/**
 * Initialize multi-currency wallets for user
 * POST /api/wallet/initialize
 */
exports.initializeWallets = async (req, res) => {
  try {
    const userId = req.user.id;

    const wallets = await multiCurrencyWalletService.initializeUserWallets(userId);

    return res.status(200).json({
      success: true,
      message: 'Multi-currency wallets initialized successfully',
      wallets
    });
  } catch (error) {
    console.error('Initialize wallets error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to initialize wallets'
    });
  }
};

/**
 * Credit wallet with earnings or refunds
 * POST /api/wallet/credit
 */
exports.creditWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency, amount, reference, description, metadata } = req.body;

    // Validate input
    if (!currency || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Currency and amount are required'
      });
    }

    const result = await multiCurrencyWalletService.creditWallet({
      userId,
      currency: currency.toUpperCase(),
      amount: parseFloat(amount),
      reference,
      description: description || 'Wallet credit',
      metadata: metadata || {}
    });

    return res.status(200).json({
      success: true,
      message: `Successfully credited ${amount} ${currency.toUpperCase()}`,
      wallet: result
    });
  } catch (error) {
    console.error('Credit wallet error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to credit wallet'
    });
  }
};

/**
 * Transfer between wallets (same currency only)
 * POST /api/wallet/transfer
 */
exports.transferBetweenWallets = async (req, res) => {
  try {
    const fromUserId = req.user.id;
    const { toUserId, currency, amount, description } = req.body;

    // Validate input
    if (!toUserId || !currency || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Recipient user ID, currency, and amount are required'
      });
    }

    if (fromUserId === parseInt(toUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to yourself'
      });
    }

    const reference = `transfer_${Date.now()}_${fromUserId}_${toUserId}`;

    const result = await multiCurrencyWalletService.transferBetweenWallets({
      fromUserId,
      toUserId: parseInt(toUserId),
      currency: currency.toUpperCase(),
      amount: parseFloat(amount),
      reference,
      description: description || 'Wallet transfer'
    });

    return res.status(200).json({
      success: true,
      message: `Successfully transferred ${amount} ${currency.toUpperCase()}`,
      transfer: result
    });
  } catch (error) {
    console.error('Transfer between wallets error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to transfer funds'
    });
  }
};

/**
 * Get balance for specific currency with transaction history
 * GET /api/wallet/balance/:currency/history
 */
exports.getCurrencyBalanceWithHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.params;
    const { startDate, endDate, limit = 50, offset = 0 } = req.query;

    // Validate currency
    multiCurrencyWalletService.validateCurrency(currency);

    const result = await multiCurrencyBalanceService.getCurrencyBalanceWithHistory({
      userId,
      currency: currency.toUpperCase(),
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get currency balance with history error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch currency balance with history'
    });
  }
};

/**
 * Get all currency balances with optional history
 * GET /api/wallet/balances/detailed
 */
exports.getAllBalancesDetailed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currencies, includeHistory = false, historyLimit = 10 } = req.query;

    let targetCurrencies = null;
    if (currencies) {
      targetCurrencies = currencies.split(',').map(c => c.trim().toUpperCase());
    }

    const result = await multiCurrencyBalanceService.getAllCurrencyBalances({
      userId,
      currencies: targetCurrencies,
      includeHistory: includeHistory === 'true',
      historyLimit: parseInt(historyLimit)
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get all balances detailed error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch detailed balances'
    });
  }
};

/**
 * Get filtered transaction history
 * GET /api/wallet/transactions/filtered
 */
exports.getFilteredTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      currency, 
      types, 
      startDate, 
      endDate, 
      limit = 50, 
      offset = 0 
    } = req.query;

    let transactionTypes = null;
    if (types) {
      transactionTypes = types.split(',').map(t => t.trim());
    }

    const result = await multiCurrencyBalanceService.getFilteredTransactionHistory({
      userId,
      currency: currency ? currency.toUpperCase() : null,
      transactionTypes,
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get filtered transactions error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch filtered transactions'
    });
  }
};

/**
 * Get balance analytics for a currency
 * GET /api/wallet/analytics/:currency
 */
exports.getBalanceAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.params;
    const { period = 'day', periods = 30 } = req.query;

    // Validate currency
    multiCurrencyWalletService.validateCurrency(currency);

    // Validate period
    const validPeriods = ['day', 'week', 'month'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
      });
    }

    const result = await multiCurrencyBalanceService.getBalanceAnalytics({
      userId,
      currency: currency.toUpperCase(),
      period,
      periods: Math.min(parseInt(periods), 365) // Cap at 365 periods
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get balance analytics error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch balance analytics'
    });
  }
};

/**
 * Get required gateway for currency
 * GET /api/wallet/gateway/:currency
 */
exports.getRequiredGateway = async (req, res) => {
  try {
    const { currency } = req.params;

    multiCurrencyWalletService.validateCurrency(currency);

    const gateway = multiCurrencyWalletService.getRequiredGateway(currency.toUpperCase());

    return res.status(200).json({
      success: true,
      currency: currency.toUpperCase(),
      requiredGateway: gateway
    });
  } catch (error) {
    console.error('Get required gateway error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to get gateway information'
    });
  }
};

/**
 * Validate currency-gateway pairing
 * POST /api/wallet/validate-gateway
 */
exports.validateGatewayPairing = async (req, res) => {
  try {
    const { currency, gateway } = req.body;

    if (!currency || !gateway) {
      return res.status(400).json({
        success: false,
        message: 'Currency and gateway are required'
      });
    }

    multiCurrencyWalletService.validateCurrencyGatewayPairing(currency.toUpperCase(), gateway);

    return res.status(200).json({
      success: true,
      message: `${currency.toUpperCase()} and ${gateway} pairing is valid`,
      currency: currency.toUpperCase(),
      gateway
    });
  } catch (error) {
    console.error('Validate gateway pairing error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Invalid gateway pairing'
    });
  }
};