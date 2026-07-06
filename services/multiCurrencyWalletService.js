const databaseTransactionService = require('./databaseTransactionService');
const sequelize = require('../config/db');

/**
 * Multi-Currency Wallet Service
 * 
 * Provides secure multi-currency wallet management with:
 * - Separate balance tracking for NGN and USD
 * - Currency isolation enforcement (no cross-currency mixing)
 * - Atomic wallet operations with transaction safety
 * - Automatic wallet initialization for new users
 * - Gateway routing enforcement (NGN→Paystack, USD→Stripe)
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

class MultiCurrencyWalletService {
  constructor() {
    this.transactionService = databaseTransactionService;
    this.supportedCurrencies = ['NGN', 'USD'];
    this.gatewayMapping = {
      'NGN': 'paystack',
      'USD': 'stripe'
    };
  }

  /**
   * Initialize wallets for a new user (both NGN and USD)
   * @param {number} userId - User ID
   * @returns {Promise<Object>} Created wallet accounts
   */
  async initializeUserWallets(userId) {
    try {
      const wallets = await this.transactionService.executeWithTransaction(
        async (transaction) => {
          const createdWallets = {};
          
          for (const currency of this.supportedCurrencies) {
            // Check if wallet already exists
            const existingWallet = await this.getWalletAccount(userId, currency, transaction);
            
            if (!existingWallet) {
              const wallet = await this.transactionService.createWalletInTransaction(
                userId,
                currency,
                transaction
              );
              createdWallets[currency] = this.formatWalletResponse(wallet);
            } else {
              createdWallets[currency] = this.formatWalletResponse(existingWallet);
            }
          }
          
          return createdWallets;
        },
        { operationType: 'initialize_user_wallets', userId }
      );

      console.log(`[Multi-Currency Wallet] Initialized wallets for user ${userId}`);
      return wallets;
    } catch (error) {
      console.error('Initialize user wallets error:', error);
      throw new Error(`Failed to initialize wallets for user ${userId}: ${error.message}`);
    }
  }

  /**
   * Get wallet account for specific currency
   * @param {number} userId - User ID
   * @param {string} currency - Currency code (NGN/USD)
   * @param {Transaction} transaction - Optional database transaction
   * @returns {Promise<Object|null>} Wallet account or null
   */
  async getWalletAccount(userId, currency, transaction = null) {
    try {
      this.validateCurrency(currency);
      
      const WalletAccount = sequelize.models.WalletAccount;
      if (!WalletAccount) {
        throw new Error('WalletAccount model not found. Ensure database migration has been run.');
      }

      const wallet = await WalletAccount.findOne({
        where: { user_id: userId, currency },
        transaction
      });

      return wallet;
    } catch (error) {
      console.error('Get wallet account error:', error);
      throw error;
    }
  }

  /**
   * Get all wallet balances for a user
   * @param {number} userId - User ID
   * @returns {Promise<Object>} Balances for all currencies
   */
  async getAllWalletBalances(userId) {
    try {
      const balances = {};
      
      for (const currency of this.supportedCurrencies) {
        const wallet = await this.getWalletAccount(userId, currency);
        
        if (wallet) {
          balances[currency] = this.formatWalletResponse(wallet);
        } else {
          // Auto-initialize missing wallet
          const newWallet = await this.initializeCurrencyWallet(userId, currency);
          balances[currency] = newWallet;
        }
      }

      return balances;
    } catch (error) {
      console.error('Get all wallet balances error:', error);
      throw error;
    }
  }

  /**
   * Initialize wallet for specific currency
   * @param {number} userId - User ID
   * @param {string} currency - Currency code
   * @returns {Promise<Object>} Created wallet
   */
  async initializeCurrencyWallet(userId, currency) {
    try {
      this.validateCurrency(currency);

      const wallet = await this.transactionService.executeWithTransaction(
        async (transaction) => {
          return await this.transactionService.createWalletInTransaction(
            userId,
            currency,
            transaction
          );
        },
        { operationType: 'initialize_currency_wallet', userId }
      );

      console.log(`[Multi-Currency Wallet] Initialized ${currency} wallet for user ${userId}`);
      return this.formatWalletResponse(wallet);
    } catch (error) {
      console.error('Initialize currency wallet error:', error);
      throw error;
    }
  }

  /**
   * Credit wallet with earnings (currency-specific)
   * @param {Object} params - Credit parameters
   * @param {number} params.userId - User ID
   * @param {string} params.currency - Currency code
   * @param {number} params.amount - Amount in currency units (e.g., 100.50)
   * @param {string} params.reference - Transaction reference
   * @param {string} params.description - Transaction description
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Updated wallet
   */
  async creditWallet({ userId, currency, amount, reference, description, metadata = {} }) {
    try {
      this.validateCurrency(currency);
      this.validateAmount(amount);

      const amountInCents = this.convertToCents(amount, currency);

      const result = await this.transactionService.executeWalletOperation(
        userId,
        currency,
        async (wallet, transaction) => {
          // Credit available balance
          await this.transactionService.updateWalletBalance(
            wallet,
            amountInCents, // Credit available
            0,             // No change to pending
            transaction
          );

          // Log the transaction
          await this.logWalletTransaction({
            walletId: wallet.id,
            type: 'credit',
            amount: amountInCents,
            currency,
            reference,
            description,
            metadata: { ...metadata, currency },
            gateway: metadata.gateway || null,
            externalReference: metadata.externalReference || null,
            status: 'completed',
            transaction
          });

          return this.formatWalletResponse(wallet);
        },
        { operationType: 'credit_wallet' }
      );

      console.log(`[Multi-Currency Wallet] Credited ${amount} ${currency} to user ${userId}`);
      return result;
    } catch (error) {
      console.error('Credit wallet error:', error);
      throw error;
    }
  }

  /**
   * Debit wallet (for withdrawals, fees, etc.)
   * @param {Object} params - Debit parameters
   * @param {number} params.userId - User ID
   * @param {string} params.currency - Currency code
   * @param {number} params.amount - Amount in currency units
   * @param {string} params.reference - Transaction reference
   * @param {string} params.description - Transaction description
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Updated wallet
   */
  async debitWallet({ userId, currency, amount, reference, description, metadata = {} }) {
    try {
      this.validateCurrency(currency);
      this.validateAmount(amount);

      const amountInCents = this.convertToCents(amount, currency);

      const result = await this.transactionService.executeWalletOperation(
        userId,
        currency,
        async (wallet, transaction) => {
          // Debit available balance
          await this.transactionService.updateWalletBalance(
            wallet,
            -amountInCents, // Debit available
            0,              // No change to pending
            transaction
          );

          // Log the transaction
          await this.logWalletTransaction({
            walletId: wallet.id,
            type: 'debit',
            amount: amountInCents,
            currency,
            reference,
            description,
            metadata: { ...metadata, currency },
            gateway: metadata.gateway || null,
            externalReference: metadata.externalReference || null,
            status: 'completed',
            transaction
          });

          return this.formatWalletResponse(wallet);
        },
        { operationType: 'debit_wallet' }
      );

      console.log(`[Multi-Currency Wallet] Debited ${amount} ${currency} from user ${userId}`);
      return result;
    } catch (error) {
      console.error('Debit wallet error:', error);
      throw error;
    }
  }

  /**
   * Transfer funds between wallets (same currency only)
   * @param {Object} params - Transfer parameters
   * @param {number} params.fromUserId - Sender user ID
   * @param {number} params.toUserId - Receiver user ID
   * @param {string} params.currency - Currency code
   * @param {number} params.amount - Amount to transfer
   * @param {string} params.reference - Transaction reference
   * @param {string} params.description - Transfer description
   * @returns {Promise<Object>} Transfer result
   */
  async transferBetweenWallets({ fromUserId, toUserId, currency, amount, reference, description }) {
    try {
      this.validateCurrency(currency);
      this.validateAmount(amount);

      if (fromUserId === toUserId) {
        throw new Error('Cannot transfer to the same wallet');
      }

      const amountInCents = this.convertToCents(amount, currency);

      const operations = [
        {
          userId: fromUserId,
          currency,
          operation: async (wallet, transaction) => {
            // Debit sender
            await this.transactionService.updateWalletBalance(
              wallet,
              -amountInCents,
              0,
              transaction
            );

            await this.logWalletTransaction({
              walletId: wallet.id,
              type: 'transfer_out',
              amount: amountInCents,
              currency,
              reference,
              description: `Transfer to user ${toUserId}: ${description}`,
              metadata: { currency, toUserId, transferType: 'outgoing' },
              transaction
            });

            return { type: 'debit', userId: fromUserId, amount: amountInCents };
          }
        },
        {
          userId: toUserId,
          currency,
          operation: async (wallet, transaction) => {
            // Credit receiver
            await this.transactionService.updateWalletBalance(
              wallet,
              amountInCents,
              0,
              transaction
            );

            await this.logWalletTransaction({
              walletId: wallet.id,
              type: 'transfer_in',
              amount: amountInCents,
              currency,
              reference,
              description: `Transfer from user ${fromUserId}: ${description}`,
              metadata: { currency, fromUserId, transferType: 'incoming' },
              transaction
            });

            return { type: 'credit', userId: toUserId, amount: amountInCents };
          }
        }
      ];

      const results = await this.transactionService.executeMultiWalletOperation(
        operations,
        { operationType: 'wallet_transfer' }
      );

      console.log(`[Multi-Currency Wallet] Transferred ${amount} ${currency} from user ${fromUserId} to ${toUserId}`);
      
      return {
        success: true,
        amount,
        currency,
        fromUserId,
        toUserId,
        reference,
        results
      };
    } catch (error) {
      console.error('Transfer between wallets error:', error);
      throw error;
    }
  }

  /**
   * Get required payment gateway for currency
   * @param {string} currency - Currency code
   * @returns {string} Gateway name
   */
  getRequiredGateway(currency) {
    this.validateCurrency(currency);
    return this.gatewayMapping[currency];
  }

  /**
   * Validate currency-gateway pairing
   * @param {string} currency - Currency code
   * @param {string} gateway - Gateway name
   * @throws {Error} If pairing is invalid
   */
  validateCurrencyGatewayPairing(currency, gateway) {
    this.validateCurrency(currency);
    
    const requiredGateway = this.getRequiredGateway(currency);
    if (gateway !== requiredGateway) {
      throw new Error(
        `Invalid gateway for ${currency}. ${currency} transactions must use ${requiredGateway}, got ${gateway}`
      );
    }
  }

  /**
   * Validate currency code
   * @param {string} currency - Currency to validate
   * @throws {Error} If currency is not supported
   */
  validateCurrency(currency) {
    if (!currency || typeof currency !== 'string') {
      throw new Error('Currency is required and must be a string');
    }

    if (!this.supportedCurrencies.includes(currency.toUpperCase())) {
      throw new Error(`Unsupported currency: ${currency}. Supported currencies: ${this.supportedCurrencies.join(', ')}`);
    }
  }

  /**
   * Validate amount
   * @param {number} amount - Amount to validate
   * @throws {Error} If amount is invalid
   */
  validateAmount(amount) {
    if (typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
      throw new Error('Amount must be a positive number');
    }

    if (amount > 999999999) { // Reasonable upper limit
      throw new Error('Amount exceeds maximum allowed value');
    }
  }

  /**
   * Convert currency amount to cents (smallest unit)
   * @param {number} amount - Amount in currency units
   * @param {string} currency - Currency code
   * @returns {number} Amount in cents
   */
  convertToCents(amount, currency) {
    // Both NGN and USD use 2 decimal places
    return Math.round(amount * 100);
  }

  /**
   * Convert cents to currency amount
   * @param {number} cents - Amount in cents
   * @param {string} currency - Currency code
   * @returns {number} Amount in currency units
   */
  convertFromCents(cents, currency) {
    return cents / 100;
  }

  /**
   * Format wallet response
   * @param {Object} wallet - Wallet account object
   * @returns {Object} Formatted response
   */
  formatWalletResponse(wallet) {
    // Ensure balance values are numbers (BIGINT might be returned as strings)
    const availableBalance = parseInt(wallet.balance_available) || 0;
    const pendingBalance = parseInt(wallet.balance_pending) || 0;
    
    return {
      id: wallet.id,
      userId: wallet.user_id,
      currency: wallet.currency,
      availableBalance: this.convertFromCents(availableBalance, wallet.currency),
      pendingBalance: this.convertFromCents(pendingBalance, wallet.currency),
      totalBalance: this.convertFromCents(
        availableBalance + pendingBalance, 
        wallet.currency
      ),
      createdAt: wallet.created_at,
      updatedAt: wallet.updated_at
    };
  }

  /**
   * Log wallet transaction
   * @param {Object} params - Transaction log parameters
   */
  async logWalletTransaction({ 
    walletId, 
    type, 
    amount, 
    currency,
    reference, 
    description, 
    metadata = {},
    gateway = null,
    externalReference = null,
    status = 'completed',
    transaction 
  }) {
    try {
      const WalletTransaction = sequelize.models.WalletTransaction;
      if (WalletTransaction) {
        const { v4: uuidv4 } = require('uuid');
        const idempotencyKey = metadata.idempotencyKey || uuidv4();
        
        await WalletTransaction.create({
          wallet_account_id: walletId,
          transaction_type: type,
          amount,
          currency,
          reference,
          description,
          metadata,
          status,
          gateway,
          external_reference: externalReference,
          idempotency_key: idempotencyKey,
          completed_at: status === 'completed' ? new Date() : null
        }, { transaction });
      }
    } catch (error) {
      console.error('Log wallet transaction error:', error);
      // Don't throw here as it would rollback the main transaction
    }
  }

  /**
   * Get wallet statistics
   * @param {number} userId - User ID
   * @returns {Promise<Object>} Wallet statistics
   */
  async getWalletStatistics(userId) {
    try {
      const balances = await this.getAllWalletBalances(userId);
      
      const stats = {
        totalWallets: Object.keys(balances).length,
        currencies: Object.keys(balances),
        totalValueUSD: 0, // Would need exchange rate service
        balances
      };

      // Add gateway mapping info
      stats.gatewayMapping = {};
      for (const currency of this.supportedCurrencies) {
        stats.gatewayMapping[currency] = this.getRequiredGateway(currency);
      }

      return stats;
    } catch (error) {
      console.error('Get wallet statistics error:', error);
      throw error;
    }
  }
}

module.exports = MultiCurrencyWalletService;