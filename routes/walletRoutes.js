const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const walletTopUpController = require('../controllers/walletTopUpController');
const withdrawal2FAController = require('../controllers/withdrawal2FAController');
const currencyWithdrawalController = require('../controllers/currencyWithdrawalController');
const transactionHistoryController = require('../controllers/transactionHistoryController');
const authMiddleware = require('../middleware/authMiddleware');
const fraudDetectionMiddleware = require('../middleware/fraudDetectionMiddleware');
const withdrawalLimitMiddleware = require('../middleware/withdrawalLimitMiddleware');
const withdrawal2FAMiddleware = require('../middleware/withdrawal2FAMiddleware');
const { walletOperations, transfers } = require('../middleware/financialRateLimiter');

// ===== NEW: WALLET TOP-UP ROUTES (Quiz Integration - Option B) =====
// Initialize wallet top-up (Stripe/Paystack)
router.post('/topup/initialize', authMiddleware, walletTopUpController.initializeTopUp);

// Verify and complete wallet top-up
router.post('/topup/verify', authMiddleware, walletTopUpController.verifyTopUp);

// Get top-up transaction history
router.get('/topup/history', authMiddleware, walletTopUpController.getTopUpHistory);

// ===== EXISTING WALLET ROUTES (DO NOT REMOVE) =====

// Get wallet balance
router.get('/balance', authMiddleware, walletController.getWalletBalance);

// Get earnings breakdown
router.get('/earnings', authMiddleware, walletController.getEarnings);

// Get creator sales (who bought what)
router.get('/sales', authMiddleware, walletController.getCreatorSales);

// Initiate withdrawal (with fraud detection, withdrawal limits, and 2FA)
router.post('/withdraw', 
  authMiddleware, 
  withdrawalLimitMiddleware.checkLimits,
  fraudDetectionMiddleware.withdrawals,
  withdrawal2FAMiddleware.check2FA, // This will handle 2FA requirement
  walletController.initiateWithdrawal,
  withdrawalLimitMiddleware.recordWithdrawal
);

// Currency-specific withdrawal processing
router.post('/process-currency-withdrawal',
  authMiddleware,
  currencyWithdrawalController.processCurrencyWithdrawal
);

// Verify withdrawal OTP and complete withdrawal
router.post('/verify-withdrawal', 
  authMiddleware,
  withdrawal2FAController.verifyWithdrawalOTP
);

// Resend withdrawal OTP
router.post('/resend-withdrawal-otp', 
  authMiddleware,
  withdrawal2FAController.resendWithdrawalOTP
);

// Cancel pending withdrawal
router.post('/cancel-withdrawal', 
  authMiddleware,
  withdrawal2FAController.cancelWithdrawal
);

// Get withdrawal status
router.get('/withdrawal-status/:withdrawalId', 
  authMiddleware,
  withdrawal2FAController.getWithdrawalStatus
);

// Check currency-specific withdrawal status
router.get('/withdrawal-status/:reference/:currency',
  authMiddleware,
  currencyWithdrawalController.checkWithdrawalStatus
);

// Get 2FA configuration
router.get('/2fa-config', 
  authMiddleware,
  withdrawal2FAController.get2FAConfig
);

// Debug endpoint for checking stored OTPs (development only)
router.get('/debug-otps', 
  authMiddleware,
  withdrawal2FAController.debugStoredOTPs
);

// Currency-specific endpoints
router.get('/currency-config', currencyWithdrawalController.getCurrencyConfig);
router.get('/withdrawal-limits/:currency', currencyWithdrawalController.getWithdrawalLimits);
router.get('/supported-banks/:currency', currencyWithdrawalController.getSupportedBanks);
router.post('/calculate-withdrawal-fees', currencyWithdrawalController.calculateWithdrawalFees);
router.post('/validate-bank-account', currencyWithdrawalController.validateBankAccount);

// Get withdrawal history
router.get('/withdrawals', authMiddleware, walletController.getWithdrawals);

// Get list of banks
router.get('/banks', authMiddleware, walletController.getBanks);

// Calculate withdrawal fees (preview)
router.post('/calculate-fees', authMiddleware, walletController.calculateFees);

// Test Paystack API connectivity
router.get('/test-paystack', authMiddleware, walletController.testPaystack);

// Resolve account number to get account name
router.post('/resolve-account', authMiddleware, walletController.resolveAccount);

// Get transaction history (legacy endpoint - kept for backward compatibility)
router.get('/transactions', authMiddleware, walletController.getTransactions);

// Enhanced transaction history endpoints
router.get('/history', 
  authMiddleware, 
  transactionHistoryController.getTransactionHistory.bind(transactionHistoryController)
);

router.get('/analytics', 
  authMiddleware, 
  transactionHistoryController.getTransactionAnalytics.bind(transactionHistoryController)
);

router.get('/transaction/:id', 
  authMiddleware, 
  transactionHistoryController.getTransactionById.bind(transactionHistoryController)
);

router.post('/search-transactions', 
  authMiddleware, 
  transactionHistoryController.searchTransactions.bind(transactionHistoryController)
);

router.get('/summary', 
  authMiddleware, 
  transactionHistoryController.getTransactionSummary.bind(transactionHistoryController)
);

router.get('/export', 
  authMiddleware, 
  transactionHistoryController.exportTransactionHistory.bind(transactionHistoryController)
);

router.get('/config', 
  authMiddleware, 
  transactionHistoryController.getConfiguration.bind(transactionHistoryController)
);

// Get transaction statistics
router.get('/transaction-stats', authMiddleware, walletController.getTransactionStats);

// Export transactions to CSV (legacy endpoint - kept for backward compatibility)
router.get('/export-transactions', authMiddleware, walletController.exportTransactions);

// ===== MULTI-CURRENCY WALLET ENDPOINTS =====
// These endpoints provide enhanced multi-currency functionality
// while maintaining backward compatibility with existing endpoints

// Initialize multi-currency wallets
router.post('/initialize', 
  authMiddleware, 
  walletOperations, 
  fraudDetectionMiddleware.walletOperations, 
  walletController.initializeWallets
);

// Credit wallet (for earnings, refunds, etc.)
router.post('/credit', 
  authMiddleware, 
  walletOperations, 
  fraudDetectionMiddleware.walletOperations, 
  walletController.creditWallet
);

// Transfer between wallets
router.post('/transfer', 
  authMiddleware, 
  transfers, 
  fraudDetectionMiddleware.transfers, 
  walletController.transferBetweenWallets
);

// Get currency-specific balance with history
router.get('/balance/:currency/history', 
  authMiddleware, 
  walletController.getCurrencyBalanceWithHistory
);

// Get detailed balances for all currencies
router.get('/balances/detailed', 
  authMiddleware, 
  walletController.getAllBalancesDetailed
);

// Get filtered transactions across currencies
router.get('/transactions/filtered', 
  authMiddleware, 
  walletController.getFilteredTransactions
);

// Get balance analytics for specific currency
router.get('/analytics/:currency', 
  authMiddleware, 
  walletController.getBalanceAnalytics
);

// Get gateway information for currency
router.get('/gateway/:currency', 
  authMiddleware, 
  walletController.getRequiredGateway
);

// Validate currency-gateway pairing
router.post('/validate-gateway', 
  authMiddleware, 
  walletController.validateGatewayPairing
);

module.exports = router;
