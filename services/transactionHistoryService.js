const sequelize = require('../config/db');

/**
 * Enhanced Transaction History Service
 * 
 * Provides comprehensive transaction history management:
 * - Currency-filtered transaction queries
 * - Date range and operation type filtering
 * - Pagination and performance optimization
 * - Advanced search and analytics
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

class TransactionHistoryService {
  constructor() {
    // Configuration
    this.config = {
      // Default pagination settings
      pagination: {
        defaultLimit: 50,
        maxLimit: 1000
      },
      
      // Supported transaction types
      transactionTypes: {
        PAYMENT: 'payment',
        WITHDRAWAL: 'withdrawal',
        TRANSFER: 'transfer',
        DEPOSIT: 'deposit',
        REFUND: 'refund',
        FEE: 'fee',
        CREDIT: 'credit',
        DEBIT: 'debit'
      },
      
      // Supported currencies
      currencies: ['NGN', 'USD'],
      
      // Transaction statuses
      statuses: {
        PENDING: 'pending',
        COMPLETED: 'completed',
        FAILED: 'failed',
        CANCELLED: 'cancelled',
        REFUNDED: 'refunded'
      },
      
      // Search fields
      searchFields: [
        'reference',
        'description',
        'gateway_reference',
        'metadata'
      ]
    };
  }

  /**
   * Get transaction history with advanced filtering
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Object>} Transaction history with metadata
   */
  async getTransactionHistory(filters = {}) {
    try {
      const {
        userId,
        currency,
        type,
        status,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        search,
        limit = this.config.pagination.defaultLimit,
        offset = 0,
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = filters;

      console.log(`[Transaction History] Getting history for user ${userId} with filters:`, filters);

      // Build WHERE clause
      const whereConditions = [];
      const replacements = {};

      if (userId) {
        whereConditions.push('wa.user_id = :userId');
        replacements.userId = userId;
      }

      if (currency) {
        whereConditions.push('ft.currency = :currency');
        replacements.currency = currency.toUpperCase();
      }

      if (type) {
        // Map generic types to financial transaction types
        let mappedType = type;
        if (type === 'credit' || type === 'deposit') {
          mappedType = 'credit';
        } else if (type === 'debit' || type === 'withdrawal') {
          mappedType = 'debit';
        }
        whereConditions.push('ft.transaction_type = :type');
        replacements.type = mappedType;
      }

      if (status) {
        whereConditions.push('ft.status = :status');
        replacements.status = status;
      }

      if (startDate) {
        whereConditions.push('ft.created_at >= :startDate');
        replacements.startDate = startDate;
      }

      if (endDate) {
        whereConditions.push('ft.created_at <= :endDate');
        replacements.endDate = endDate;
      }

      if (minAmount !== undefined) {
        // Convert to smallest currency unit
        whereConditions.push('ft.amount >= :minAmount');
        replacements.minAmount = parseFloat(minAmount) * 100;
      }

      if (maxAmount !== undefined) {
        // Convert to smallest currency unit
        whereConditions.push('ft.amount <= :maxAmount');
        replacements.maxAmount = parseFloat(maxAmount) * 100;
      }

      if (search) {
        whereConditions.push(`(
          ft.reference ILIKE :search OR 
          ft.description ILIKE :search OR
          ft.external_reference ILIKE :search OR
          ft.metadata::text ILIKE :search
        )`);
        replacements.search = `%${search}%`;
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      // Validate sort parameters (update for financial_transactions table)
      const validSortFields = ['created_at', 'amount', 'transaction_type', 'currency', 'status'];
      const validSortOrders = ['ASC', 'DESC'];
      
      const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
      const safeSortOrder = validSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

      // Get total count
      const [countResult] = await sequelize.query(`
        SELECT COUNT(*) as total
        FROM financial_transactions ft
        JOIN wallet_accounts wa ON ft.wallet_id = wa.id
        ${whereClause}
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      const totalCount = parseInt(countResult.total);

      // Get transactions
      const transactions = await sequelize.query(`
        SELECT 
          ft.id,
          wa.user_id,
          ft.transaction_type as type,
          ft.amount,
          ft.currency,
          ft.status,
          ft.reference,
          ft.external_reference as gateway_reference,
          ft.description,
          ft.metadata,
          ft.created_at,
          ft.completed_at as updated_at
        FROM financial_transactions ft
        JOIN wallet_accounts wa ON ft.wallet_id = wa.id
        ${whereClause}
        ORDER BY ft.${safeSortBy} ${safeSortOrder}
        LIMIT :limit OFFSET :offset
      `, {
        replacements: {
          ...replacements,
          limit: Math.min(parseInt(limit), this.config.pagination.maxLimit),
          offset: parseInt(offset)
        },
        type: sequelize.QueryTypes.SELECT
      });

      // Parse metadata for each transaction
      const parsedTransactions = transactions.map(tx => ({
        ...tx,
        metadata: this.parseJSON(tx.metadata),
        // Convert from smallest currency unit (kobo/cents) to main unit
        amount: parseFloat(tx.amount) / 100,
        // Remove compatibility fields since we have real data now
        reference: tx.reference,
        gateway_reference: tx.gateway_reference
      }));

      // Calculate summary statistics
      const summary = await this.calculateSummary(filters, whereClause, replacements);

      return {
        success: true,
        transactions: parsedTransactions,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          pages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: Math.floor(parseInt(offset) / parseInt(limit)) + 1
        },
        summary,
        filters: {
          ...filters,
          sortBy: safeSortBy,
          sortOrder: safeSortOrder
        }
      };
    } catch (error) {
      console.error('[Transaction History] Get history error:', error);
      throw error;
    }
  }

  /**
   * Get transaction analytics
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Object>} Transaction analytics
   */
  async getTransactionAnalytics(filters = {}) {
    try {
      const {
        userId,
        currency,
        startDate,
        endDate,
        groupBy = 'day' // day, week, month, year
      } = filters;

      console.log(`[Transaction History] Getting analytics for user ${userId}`);

      // Build WHERE clause
      const whereConditions = [];
      const replacements = {};

      if (userId) {
        whereConditions.push('wa.user_id = :userId');
        replacements.userId = userId;
      }

      if (currency) {
        whereConditions.push('ft.currency = :currency');
        replacements.currency = currency.toUpperCase();
      }

      if (startDate) {
        whereConditions.push('ft.created_at >= :startDate');
        replacements.startDate = startDate;
      }

      if (endDate) {
        whereConditions.push('ft.created_at <= :endDate');
        replacements.endDate = endDate;
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      // Determine date grouping
      let dateGrouping;
      switch (groupBy) {
        case 'hour':
          dateGrouping = "DATE_TRUNC('hour', ft.created_at)";
          break;
        case 'day':
          dateGrouping = "DATE_TRUNC('day', ft.created_at)";
          break;
        case 'week':
          dateGrouping = "DATE_TRUNC('week', ft.created_at)";
          break;
        case 'month':
          dateGrouping = "DATE_TRUNC('month', ft.created_at)";
          break;
        case 'year':
          dateGrouping = "DATE_TRUNC('year', ft.created_at)";
          break;
        default:
          dateGrouping = "DATE_TRUNC('day', ft.created_at)";
      }

      // Get time-series data
      const timeSeriesData = await sequelize.query(`
        SELECT 
          ${dateGrouping} as period,
          ft.currency,
          ft.transaction_type as type,
          COUNT(*) as transaction_count,
          SUM(ft.amount) as total_amount,
          AVG(ft.amount) as avg_amount,
          MIN(ft.amount) as min_amount,
          MAX(ft.amount) as max_amount
        FROM financial_transactions ft
        JOIN wallet_accounts wa ON ft.wallet_id = wa.id
        ${whereClause}
        GROUP BY ${dateGrouping}, ft.currency, ft.transaction_type
        ORDER BY period DESC, ft.currency, ft.transaction_type
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      // Get overall statistics
      const overallStats = await sequelize.query(`
        SELECT 
          ft.currency,
          ft.transaction_type as type,
          ft.status,
          COUNT(*) as count,
          SUM(ft.amount) as total_amount,
          AVG(ft.amount) as avg_amount
        FROM financial_transactions ft
        JOIN wallet_accounts wa ON ft.wallet_id = wa.id
        ${whereClause}
        GROUP BY ft.currency, ft.transaction_type, ft.status
        ORDER BY ft.currency, ft.transaction_type, ft.status
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      // Get top transactions
      const topTransactions = await sequelize.query(`
        SELECT 
          ft.id,
          ft.transaction_type as type,
          ft.amount,
          ft.currency,
          ft.description,
          ft.created_at
        FROM financial_transactions ft
        JOIN wallet_accounts wa ON ft.wallet_id = wa.id
        ${whereClause}
        ORDER BY ft.amount DESC
        LIMIT 10
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      return {
        success: true,
        analytics: {
          timeSeries: timeSeriesData.map(row => ({
            ...row,
            period: row.period,
            // Convert from smallest currency unit to main unit
            total_amount: parseFloat(row.total_amount) / 100,
            avg_amount: parseFloat(row.avg_amount) / 100,
            min_amount: parseFloat(row.min_amount) / 100,
            max_amount: parseFloat(row.max_amount) / 100,
            transaction_count: parseInt(row.transaction_count)
          })),
          overallStats: overallStats.map(row => ({
            ...row,
            count: parseInt(row.count),
            // Convert from smallest currency unit to main unit
            total_amount: parseFloat(row.total_amount) / 100,
            avg_amount: parseFloat(row.avg_amount) / 100
          })),
          topTransactions: topTransactions.map(row => ({
            ...row,
            // Convert from smallest currency unit to main unit
            amount: parseFloat(row.amount) / 100
          }))
        },
        filters: {
          ...filters,
          groupBy
        }
      };
    } catch (error) {
      console.error('[Transaction History] Get analytics error:', error);
      throw error;
    }
  }

  /**
   * Get transaction by ID
   * @param {string} transactionId - Transaction ID
   * @param {number} userId - User ID (for security)
   * @returns {Promise<Object>} Transaction details
   */
  async getTransactionById(transactionId, userId = null) {
    try {
      const whereConditions = ['ft.id = :transactionId'];
      const replacements = { transactionId };

      if (userId) {
        whereConditions.push('wa.user_id = :userId');
        replacements.userId = userId;
      }

      const [transaction] = await sequelize.query(`
        SELECT 
          ft.id,
          wa.user_id,
          ft.transaction_type as type,
          ft.amount,
          ft.currency,
          ft.status,
          ft.reference,
          ft.external_reference as gateway_reference,
          ft.description,
          ft.metadata,
          ft.created_at,
          ft.completed_at as updated_at
        FROM financial_transactions ft
        JOIN wallet_accounts wa ON ft.wallet_id = wa.id
        WHERE ${whereConditions.join(' AND ')}
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      if (!transaction) {
        return {
          success: false,
          message: 'Transaction not found'
        };
      }

      return {
        success: true,
        transaction: {
          ...transaction,
          metadata: this.parseJSON(transaction.metadata),
          // Convert from smallest currency unit to main unit
          amount: parseFloat(transaction.amount) / 100
        }
      };
    } catch (error) {
      console.error('[Transaction History] Get by ID error:', error);
      throw error;
    }
  }

  /**
   * Search transactions with advanced criteria
   * @param {Object} searchCriteria - Search criteria
   * @returns {Promise<Object>} Search results
   */
  async searchTransactions(searchCriteria = {}) {
    try {
      const {
        userId,
        query,
        filters = {},
        limit = 50,
        offset = 0
      } = searchCriteria;

      // Combine search query with filters
      const combinedFilters = {
        ...filters,
        userId,
        search: query,
        limit,
        offset
      };

      return await this.getTransactionHistory(combinedFilters);
    } catch (error) {
      console.error('[Transaction History] Search error:', error);
      throw error;
    }
  }

  /**
   * Get transaction summary for user
   * @param {number} userId - User ID
   * @param {string} period - Period (today, week, month, year, all)
   * @returns {Promise<Object>} Transaction summary
   */
  async getTransactionSummary(userId, period = 'month') {
    try {
      let startDate;
      const now = new Date();

      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = null;
      }

      const filters = {
        userId,
        startDate: startDate ? startDate.toISOString() : null
      };

      const history = await this.getTransactionHistory(filters);
      
      return {
        success: true,
        summary: history.summary,
        period,
        transactionCount: history.pagination.total
      };
    } catch (error) {
      console.error('[Transaction History] Get summary error:', error);
      throw error;
    }
  }

  /**
   * Calculate summary statistics
   * @param {Object} filters - Original filters
   * @param {string} whereClause - SQL WHERE clause
   * @param {Object} replacements - SQL replacements
   * @returns {Promise<Object>} Summary statistics
   */
  async calculateSummary(filters, whereClause, replacements) {
    try {
      const summaryResult = await sequelize.query(`
        SELECT 
          ft.currency,
          ft.transaction_type as type,
          ft.status,
          COUNT(*) as count,
          SUM(ft.amount) as total_amount,
          AVG(ft.amount) as avg_amount,
          MIN(ft.amount) as min_amount,
          MAX(ft.amount) as max_amount
        FROM financial_transactions ft
        JOIN wallet_accounts wa ON ft.wallet_id = wa.id
        ${whereClause}
        GROUP BY ft.currency, ft.transaction_type, ft.status
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      // Organize summary by currency
      const summary = {
        byCurrency: {},
        byType: {},
        byStatus: {},
        overall: {
          totalTransactions: 0,
          totalAmount: 0
        }
      };

      summaryResult.forEach(row => {
        const currency = row.currency;
        const type = row.type;
        const status = row.status;
        const count = parseInt(row.count);
        // Convert from smallest currency unit to main unit
        const totalAmount = parseFloat(row.total_amount) / 100;

        // By currency
        if (!summary.byCurrency[currency]) {
          summary.byCurrency[currency] = {
            count: 0,
            totalAmount: 0,
            avgAmount: 0
          };
        }
        summary.byCurrency[currency].count += count;
        summary.byCurrency[currency].totalAmount += totalAmount;

        // By type
        if (!summary.byType[type]) {
          summary.byType[type] = {
            count: 0,
            totalAmount: 0
          };
        }
        summary.byType[type].count += count;
        summary.byType[type].totalAmount += totalAmount;

        // By status
        if (!summary.byStatus[status]) {
          summary.byStatus[status] = {
            count: 0,
            totalAmount: 0
          };
        }
        summary.byStatus[status].count += count;
        summary.byStatus[status].totalAmount += totalAmount;

        // Overall
        summary.overall.totalTransactions += count;
        summary.overall.totalAmount += totalAmount;
      });

      // Calculate averages
      Object.keys(summary.byCurrency).forEach(currency => {
        const currencyData = summary.byCurrency[currency];
        currencyData.avgAmount = currencyData.count > 0 
          ? currencyData.totalAmount / currencyData.count 
          : 0;
      });

      if (summary.overall.totalTransactions > 0) {
        summary.overall.avgAmount = summary.overall.totalAmount / summary.overall.totalTransactions;
      }

      return summary;
    } catch (error) {
      console.error('[Transaction History] Calculate summary error:', error);
      return {
        byCurrency: {},
        byType: {},
        byStatus: {},
        overall: {
          totalTransactions: 0,
          totalAmount: 0,
          avgAmount: 0
        }
      };
    }
  }

  /**
   * Parse JSON safely
   * @param {string} jsonString - JSON string to parse
   * @returns {Object} Parsed object or original string
   */
  parseJSON(jsonString) {
    if (!jsonString) return {};
    
    try {
      return JSON.parse(jsonString);
    } catch {
      return jsonString;
    }
  }

  /**
   * Get service configuration
   * @returns {Object} Service configuration
   */
  getConfiguration() {
    return {
      transactionTypes: this.config.transactionTypes,
      currencies: this.config.currencies,
      statuses: this.config.statuses,
      pagination: this.config.pagination,
      searchFields: this.config.searchFields
    };
  }
}

module.exports = TransactionHistoryService;