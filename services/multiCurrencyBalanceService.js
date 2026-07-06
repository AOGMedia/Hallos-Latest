const { Op } = require('sequelize');
const sequelize = require('../config/db');
const MultiCurrencyWalletService = require('./multiCurrencyWalletService');

/**
 * Multi-Currency Balance Query Service
 * 
 * Provides advanced balance querying capabilities with:
 * - Currency-filtered balance queries
 * - Date range and operation type filtering
 * - Transaction history with pagination
 * - Performance-optimized queries with proper indexing
 * - Balance calculations and analytics
 * 
 * Requirements: 6.4, 13.1, 13.2
 */

class MultiCurrencyBalanceService {
  constructor() {
    this.walletService = new MultiCurrencyWalletService();
  }

  /**
   * Get balance for specific currency with transaction history
   * @param {Object} params - Query parameters
   * @param {number} params.userId - User ID
   * @param {string} params.currency - Currency code (NGN/USD)
   * @param {string} params.startDate - Start date (ISO string)
   * @param {string} params.endDate - End date (ISO string)
   * @param {number} params.limit - Results limit (default: 50)
   * @param {number} params.offset - Results offset (default: 0)
   * @returns {Promise<Object>} Balance and transaction history
   */
  async getCurrencyBalanceWithHistory({ 
    userId, 
    currency, 
    startDate = null, 
    endDate = null, 
    limit = 50, 
    offset = 0 
  }) {
    try {
      this.walletService.validateCurrency(currency);

      // Get current wallet balance
      const wallet = await this.walletService.getWalletAccount(userId, currency.toUpperCase());
      
      if (!wallet) {
        // Auto-initialize wallet if it doesn't exist
        const newWallet = await this.walletService.initializeCurrencyWallet(userId, currency.toUpperCase());
        return {
          balance: newWallet,
          transactions: {
            total: 0,
            data: [],
            pagination: { limit, offset, hasMore: false }
          },
          summary: {
            totalTransactions: 0,
            totalCredits: 0,
            totalDebits: 0,
            netChange: 0
          }
        };
      }

      const formattedBalance = this.walletService.formatWalletResponse(wallet);

      // Build transaction query
      const whereClause = {
        wallet_account_id: wallet.id
      };

      // Add date filtering
      if (startDate || endDate) {
        whereClause.created_at = {};
        if (startDate) {
          whereClause.created_at[Op.gte] = new Date(startDate);
        }
        if (endDate) {
          whereClause.created_at[Op.lte] = new Date(endDate);
        }
      }

      // Get transaction history
      const WalletTransaction = sequelize.models.WalletTransaction;
      let transactions = { total: 0, data: [] };
      let summary = {
        totalTransactions: 0,
        totalCredits: 0,
        totalDebits: 0,
        netChange: 0
      };

      if (WalletTransaction) {
        // Get paginated transactions
        const transactionResults = await WalletTransaction.findAndCountAll({
          where: whereClause,
          order: [['created_at', 'DESC']],
          limit: Math.min(limit, 100), // Cap at 100 for performance
          offset,
          attributes: [
            'id',
            'transaction_type',
            'amount',
            'balance_before',
            'balance_after',
            'reference',
            'description',
            'metadata',
            'created_at'
          ]
        });

        transactions = {
          total: transactionResults.count,
          data: transactionResults.rows.map(tx => ({
            id: tx.id,
            type: tx.transaction_type,
            amount: this.walletService.convertFromCents(tx.amount, currency),
            balanceBefore: this.walletService.convertFromCents(tx.balance_before, currency),
            balanceAfter: this.walletService.convertFromCents(tx.balance_after, currency),
            reference: tx.reference,
            description: tx.description,
            metadata: tx.metadata,
            createdAt: tx.created_at
          }))
        };

        // Calculate summary statistics
        const summaryResults = await WalletTransaction.findAll({
          where: whereClause,
          attributes: [
            'transaction_type',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('SUM', sequelize.col('amount')), 'total_amount']
          ],
          group: ['transaction_type'],
          raw: true
        });

        summary = this.calculateTransactionSummary(summaryResults, currency);
      }

      return {
        balance: formattedBalance,
        transactions: {
          ...transactions,
          pagination: {
            limit,
            offset,
            hasMore: offset + limit < transactions.total
          }
        },
        summary
      };
    } catch (error) {
      console.error('Get currency balance with history error:', error);
      throw error;
    }
  }

  /**
   * Get balances for all currencies with optional filtering
   * @param {Object} params - Query parameters
   * @param {number} params.userId - User ID
   * @param {Array} params.currencies - Specific currencies to query (optional)
   * @param {boolean} params.includeHistory - Include recent transaction history
   * @param {number} params.historyLimit - Limit for transaction history (default: 10)
   * @returns {Promise<Object>} Multi-currency balances
   */
  async getAllCurrencyBalances({ 
    userId, 
    currencies = null, 
    includeHistory = false, 
    historyLimit = 10 
  }) {
    try {
      const targetCurrencies = currencies || this.walletService.supportedCurrencies;
      
      // Validate all requested currencies
      targetCurrencies.forEach(currency => {
        this.walletService.validateCurrency(currency);
      });

      const balances = {};
      
      for (const currency of targetCurrencies) {
        if (includeHistory) {
          const balanceWithHistory = await this.getCurrencyBalanceWithHistory({
            userId,
            currency,
            limit: historyLimit,
            offset: 0
          });
          balances[currency] = balanceWithHistory;
        } else {
          const wallet = await this.walletService.getWalletAccount(userId, currency);
          if (wallet) {
            balances[currency] = {
              balance: this.walletService.formatWalletResponse(wallet)
            };
          } else {
            // Auto-initialize missing wallet
            const newWallet = await this.walletService.initializeCurrencyWallet(userId, currency);
            balances[currency] = {
              balance: newWallet
            };
          }
        }
      }

      return {
        userId,
        currencies: targetCurrencies,
        balances,
        summary: this.calculateMultiCurrencySummary(balances)
      };
    } catch (error) {
      console.error('Get all currency balances error:', error);
      throw error;
    }
  }

  /**
   * Get filtered transaction history across currencies
   * @param {Object} params - Query parameters
   * @param {number} params.userId - User ID
   * @param {string} params.currency - Currency filter (optional)
   * @param {Array} params.transactionTypes - Transaction type filter (optional)
   * @param {string} params.startDate - Start date filter
   * @param {string} params.endDate - End date filter
   * @param {number} params.limit - Results limit
   * @param {number} params.offset - Results offset
   * @returns {Promise<Object>} Filtered transaction history
   */
  async getFilteredTransactionHistory({ 
    userId, 
    currency = null, 
    transactionTypes = null, 
    startDate = null, 
    endDate = null, 
    limit = 50, 
    offset = 0 
  }) {
    try {
      const WalletTransaction = sequelize.models.WalletTransaction;
      if (!WalletTransaction) {
        return {
          total: 0,
          transactions: [],
          pagination: { limit, offset, hasMore: false },
          filters: { currency, transactionTypes, startDate, endDate }
        };
      }

      // Get user's wallet accounts
      const whereClause = {};
      const walletIds = [];

      if (currency) {
        this.walletService.validateCurrency(currency);
        const wallet = await this.walletService.getWalletAccount(userId, currency.toUpperCase());
        if (wallet) {
          walletIds.push(wallet.id);
        }
      } else {
        // Get all user's wallets
        const WalletAccount = sequelize.models.WalletAccount;
        if (WalletAccount) {
          const wallets = await WalletAccount.findAll({
            where: { user_id: userId },
            attributes: ['id', 'currency']
          });
          walletIds.push(...wallets.map(w => w.id));
        }
      }

      if (walletIds.length === 0) {
        return {
          total: 0,
          transactions: [],
          pagination: { limit, offset, hasMore: false },
          filters: { currency, transactionTypes, startDate, endDate }
        };
      }

      whereClause.wallet_account_id = { [Op.in]: walletIds };

      // Add transaction type filtering
      if (transactionTypes && transactionTypes.length > 0) {
        whereClause.transaction_type = { [Op.in]: transactionTypes };
      }

      // Add date filtering
      if (startDate || endDate) {
        whereClause.created_at = {};
        if (startDate) {
          whereClause.created_at[Op.gte] = new Date(startDate);
        }
        if (endDate) {
          whereClause.created_at[Op.lte] = new Date(endDate);
        }
      }

      // Execute query with wallet information
      const results = await WalletTransaction.findAndCountAll({
        where: whereClause,
        include: [{
          model: sequelize.models.WalletAccount,
          as: 'wallet_account',
          attributes: ['currency'],
          required: true
        }],
        order: [['created_at', 'DESC']],
        limit: Math.min(limit, 100),
        offset,
        attributes: [
          'id',
          'transaction_type',
          'amount',
          'balance_before',
          'balance_after',
          'reference',
          'description',
          'metadata',
          'created_at'
        ]
      });

      const transactions = results.rows.map(tx => {
        const txCurrency = tx.wallet_account?.currency || 'NGN';
        return {
          id: tx.id,
          type: tx.transaction_type,
          currency: txCurrency,
          amount: this.walletService.convertFromCents(tx.amount, txCurrency),
          balanceBefore: this.walletService.convertFromCents(tx.balance_before, txCurrency),
          balanceAfter: this.walletService.convertFromCents(tx.balance_after, txCurrency),
          reference: tx.reference,
          description: tx.description,
          metadata: tx.metadata,
          createdAt: tx.created_at
        };
      });

      return {
        total: results.count,
        transactions,
        pagination: {
          limit,
          offset,
          hasMore: offset + limit < results.count
        },
        filters: { currency, transactionTypes, startDate, endDate }
      };
    } catch (error) {
      console.error('Get filtered transaction history error:', error);
      throw error;
    }
  }

  /**
   * Get balance analytics for a currency
   * @param {Object} params - Analytics parameters
   * @param {number} params.userId - User ID
   * @param {string} params.currency - Currency code
   * @param {string} params.period - Period for analytics (day, week, month)
   * @param {number} params.periods - Number of periods to analyze
   * @returns {Promise<Object>} Balance analytics
   */
  async getBalanceAnalytics({ userId, currency, period = 'day', periods = 30 }) {
    try {
      this.walletService.validateCurrency(currency);

      const wallet = await this.walletService.getWalletAccount(userId, currency.toUpperCase());
      if (!wallet) {
        return {
          currency,
          currentBalance: 0,
          analytics: [],
          summary: {
            totalPeriods: 0,
            averageBalance: 0,
            highestBalance: 0,
            lowestBalance: 0,
            totalTransactions: 0
          }
        };
      }

      const WalletTransaction = sequelize.models.WalletTransaction;
      if (!WalletTransaction) {
        return {
          currency,
          currentBalance: this.walletService.convertFromCents(wallet.balance_available, currency),
          analytics: [],
          summary: {
            totalPeriods: 0,
            averageBalance: 0,
            highestBalance: 0,
            lowestBalance: 0,
            totalTransactions: 0
          }
        };
      }

      // Calculate date intervals based on period
      const intervals = this.calculateDateIntervals(period, periods);
      
      const analytics = [];
      for (const interval of intervals) {
        const periodData = await this.getBalanceForPeriod(wallet.id, interval, currency);
        analytics.push(periodData);
      }

      const summary = this.calculateAnalyticsSummary(analytics);

      return {
        currency,
        currentBalance: this.walletService.convertFromCents(wallet.balance_available, currency),
        analytics,
        summary
      };
    } catch (error) {
      console.error('Get balance analytics error:', error);
      throw error;
    }
  }

  /**
   * Calculate transaction summary from database results
   * @private
   */
  calculateTransactionSummary(summaryResults, currency) {
    const summary = {
      totalTransactions: 0,
      totalCredits: 0,
      totalDebits: 0,
      netChange: 0
    };

    summaryResults.forEach(result => {
      const count = parseInt(result.count) || 0;
      const amount = this.walletService.convertFromCents(parseInt(result.total_amount) || 0, currency);
      
      summary.totalTransactions += count;
      
      if (['credit', 'transfer_in'].includes(result.transaction_type)) {
        summary.totalCredits += amount;
        summary.netChange += amount;
      } else if (['debit', 'transfer_out'].includes(result.transaction_type)) {
        summary.totalDebits += amount;
        summary.netChange -= amount;
      }
    });

    return summary;
  }

  /**
   * Calculate multi-currency summary
   * @private
   */
  calculateMultiCurrencySummary(balances) {
    const summary = {
      totalCurrencies: Object.keys(balances).length,
      hasBalances: false,
      currencies: {}
    };

    Object.entries(balances).forEach(([currency, data]) => {
      const balance = data.balance;
      summary.currencies[currency] = {
        availableBalance: balance.availableBalance,
        pendingBalance: balance.pendingBalance,
        totalBalance: balance.totalBalance,
        hasTransactions: data.transactions ? data.transactions.total > 0 : false
      };

      if (balance.totalBalance > 0) {
        summary.hasBalances = true;
      }
    });

    return summary;
  }

  /**
   * Calculate date intervals for analytics
   * @private
   */
  calculateDateIntervals(period, periods) {
    const intervals = [];
    const now = new Date();
    
    for (let i = periods - 1; i >= 0; i--) {
      const start = new Date(now);
      const end = new Date(now);
      
      switch (period) {
        case 'day':
          start.setDate(now.getDate() - i);
          start.setHours(0, 0, 0, 0);
          end.setDate(now.getDate() - i);
          end.setHours(23, 59, 59, 999);
          break;
        case 'week':
          start.setDate(now.getDate() - (i * 7));
          start.setHours(0, 0, 0, 0);
          end.setDate(now.getDate() - (i * 7) + 6);
          end.setHours(23, 59, 59, 999);
          break;
        case 'month':
          start.setMonth(now.getMonth() - i, 1);
          start.setHours(0, 0, 0, 0);
          end.setMonth(now.getMonth() - i + 1, 0);
          end.setHours(23, 59, 59, 999);
          break;
      }
      
      intervals.push({ start, end, period: `${period}_${i}` });
    }
    
    return intervals;
  }

  /**
   * Get balance data for a specific period
   * @private
   */
  async getBalanceForPeriod(walletId, interval, currency) {
    const WalletTransaction = sequelize.models.WalletTransaction;
    
    const transactions = await WalletTransaction.findAll({
      where: {
        wallet_account_id: walletId,
        created_at: {
          [Op.between]: [interval.start, interval.end]
        }
      },
      order: [['created_at', 'ASC']],
      attributes: ['balance_after', 'created_at', 'transaction_type', 'amount']
    });

    const startBalance = transactions.length > 0 
      ? this.walletService.convertFromCents(transactions[0].balance_after - transactions[0].amount, currency)
      : 0;
    
    const endBalance = transactions.length > 0 
      ? this.walletService.convertFromCents(transactions[transactions.length - 1].balance_after, currency)
      : startBalance;

    return {
      period: interval.period,
      startDate: interval.start,
      endDate: interval.end,
      startBalance,
      endBalance,
      change: endBalance - startBalance,
      transactionCount: transactions.length
    };
  }

  /**
   * Calculate analytics summary
   * @private
   */
  calculateAnalyticsSummary(analytics) {
    if (analytics.length === 0) {
      return {
        totalPeriods: 0,
        averageBalance: 0,
        highestBalance: 0,
        lowestBalance: 0,
        totalTransactions: 0
      };
    }

    const balances = analytics.map(a => a.endBalance);
    const totalTransactions = analytics.reduce((sum, a) => sum + a.transactionCount, 0);

    return {
      totalPeriods: analytics.length,
      averageBalance: balances.reduce((sum, b) => sum + b, 0) / balances.length,
      highestBalance: Math.max(...balances),
      lowestBalance: Math.min(...balances),
      totalTransactions
    };
  }
}

module.exports = MultiCurrencyBalanceService;