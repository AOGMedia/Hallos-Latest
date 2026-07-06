const MultiCurrencyWalletService = require('../services/multiCurrencyWalletService');
const MultiCurrencyBalanceService = require('../services/multiCurrencyBalanceService');

/**
 * Multi-Currency Wallet Controller
 * 
 * Provides API endpoints for multi-currency wallet operations with:
 * - Currency isolation enforcement
 * - Gateway routing validation
 * - Secure wallet operations
 * - Advanced balance queries and analytics
 */

const walletService = new MultiCurrencyWalletService();
const balanceService = new MultiCurrencyBalanceService();

/**
 * Initialize wallets for a user (both NGN and USD)
 * POST /api/multi-wallet/initialize
 */
exports.initializeWallets = async (req, res) => {
  try {
    const userId = req.user.id;

    const wallets = await walletService.initializeUserWallets(userId);

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
 * Get all wallet balances for a user
 * GET /api/multi-wallet/balances
 */
exports.getAllBalances = async (req, res) => {
  try {
    const userId = req.user.id;

    const balances = await walletService.getAllWalletBalances(userId);

    return res.status(200).json({
      success: true,
      balances
    });
  } catch (error) {
    console.error('Get all balances error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch wallet balances'
    });
  }
};

/**
 * Get balance for specific currency
 * GET /api/multi-wallet/balance/:currency
 */
exports.getCurrencyBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.params;

    // Validate currency
    walletService.validateCurrency(currency);

    const wallet = await walletService.getWalletAccount(userId, currency.toUpperCase());
    
    if (!wallet) {
      // Auto-initialize if wallet doesn't exist
      const newWallet = await walletService.initializeCurrencyWallet(userId, currency.toUpperCase());
      return res.status(200).json({
        success: true,
        wallet: newWallet,
        message: `${currency} wallet created automatically`
      });
    }

    const formattedWallet = walletService.formatWalletResponse(wallet);

    return res.status(200).json({
      success: true,
      wallet: formattedWallet
    });
  } catch (error) {
    console.error('Get currency balance error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch currency balance'
    });
  }
};

/**
 * Credit wallet (for earnings, refunds, etc.)
 * POST /api/multi-wallet/credit
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

    const result = await walletService.creditWallet({
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
 * POST /api/multi-wallet/transfer
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

    const result = await walletService.transferBetweenWallets({
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
 * Get required gateway for currency
 * GET /api/multi-wallet/gateway/:currency
 */
exports.getRequiredGateway = async (req, res) => {
  try {
    const { currency } = req.params;

    walletService.validateCurrency(currency);

    const gateway = walletService.getRequiredGateway(currency.toUpperCase());

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
 * POST /api/multi-wallet/validate-gateway
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

    walletService.validateCurrencyGatewayPairing(currency.toUpperCase(), gateway);

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

/**
 * Get balance for specific currency with transaction history
 * GET /api/multi-wallet/balance/:currency/history?startDate=2024-01-01&endDate=2024-01-31&limit=50&offset=0
 */
exports.getCurrencyBalanceWithHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.params;
    const { startDate, endDate, limit = 50, offset = 0 } = req.query;

    // Validate currency
    walletService.validateCurrency(currency);

    const result = await balanceService.getCurrencyBalanceWithHistory({
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
 * GET /api/multi-wallet/balances/detailed?currencies=NGN,USD&includeHistory=true&historyLimit=10
 */
exports.getAllBalancesDetailed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currencies, includeHistory = false, historyLimit = 10 } = req.query;

    let targetCurrencies = null;
    if (currencies) {
      targetCurrencies = currencies.split(',').map(c => c.trim().toUpperCase());
    }

    const result = await balanceService.getAllCurrencyBalances({
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
 * GET /api/multi-wallet/transactions?currency=NGN&types=credit,debit&startDate=2024-01-01&limit=50
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

    const result = await balanceService.getFilteredTransactionHistory({
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
 * GET /api/multi-wallet/analytics/:currency?period=day&periods=30
 */
exports.getBalanceAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.params;
    const { period = 'day', periods = 30 } = req.query;

    // Validate currency
    walletService.validateCurrency(currency);

    // Validate period
    const validPeriods = ['day', 'week', 'month'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`
      });
    }

    const result = await balanceService.getBalanceAnalytics({
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
 * Get balance summary across all currencies
 * GET /api/multi-wallet/summary
 */
exports.getBalanceSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await balanceService.getAllCurrencyBalances({
      userId,
      includeHistory: false
    });

    // Extract just the summary information
    const summary = {
      userId,
      totalCurrencies: result.summary.totalCurrencies,
      hasBalances: result.summary.hasBalances,
      balances: {},
      gateways: {}
    };

    // Add balance information
    Object.entries(result.balances).forEach(([currency, data]) => {
      summary.balances[currency] = {
        available: data.balance.availableBalance,
        pending: data.balance.pendingBalance,
        total: data.balance.totalBalance
      };
      summary.gateways[currency] = walletService.getRequiredGateway(currency);
    });

    return res.status(200).json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('Get balance summary error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch balance summary'
    });
  }
};

module.exports = exports;