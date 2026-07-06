const TransactionHistoryService = require('../services/transactionHistoryService');
const { validationResult } = require('express-validator');

/**
 * Enhanced Transaction History Controller
 * 
 * Provides comprehensive transaction history management endpoints:
 * - Currency-filtered transaction queries
 * - Date range and operation type filtering
 * - Pagination and performance optimization
 * - Advanced search and analytics
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

class TransactionHistoryController {
  constructor() {
    this.transactionHistoryService = new TransactionHistoryService();
  }

  /**
   * Get transaction history with advanced filtering
   * GET /api/wallet/history
   */
  async getTransactionHistory(req, res) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      // Admin access check
      const isAdminAccess = req.query.adminAccess === 'true' || req.adminAccess;
      const userId = isAdminAccess ? req.query.userId : req.user.id;

      const {
        currency,
        type,
        status,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        search,
        limit,
        offset,
        page,
        sortBy,
        sortOrder
      } = req.query;

      // Calculate offset from page if provided
      const calculatedOffset = page ? (parseInt(page) - 1) * (parseInt(limit) || 50) : parseInt(offset) || 0;

      const filters = {
        userId,
        currency,
        type,
        status,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        search,
        limit: limit ? parseInt(limit) : undefined,
        offset: calculatedOffset,
        sortBy,
        sortOrder
      };

      const result = await this.transactionHistoryService.getTransactionHistory(filters);

      res.json(result);
    } catch (error) {
      console.error('[Transaction History Controller] Get history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve transaction history',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get transaction analytics
   * GET /api/wallet/analytics
   */
  async getTransactionAnalytics(req, res) {
    try {
      // Admin access check
      const isAdminAccess = req.query.adminAccess === 'true' || req.adminAccess;
      const userId = isAdminAccess ? req.query.userId : req.user.id;

      const {
        currency,
        startDate,
        endDate,
        groupBy
      } = req.query;

      const filters = {
        userId,
        currency,
        startDate,
        endDate,
        groupBy
      };

      const result = await this.transactionHistoryService.getTransactionAnalytics(filters);

      res.json(result);
    } catch (error) {
      console.error('[Transaction History Controller] Get analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve transaction analytics',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get transaction by ID
   * GET /api/wallet/transaction/:id
   */
  async getTransactionById(req, res) {
    try {
      // Admin access check
      const isAdminAccess = req.adminAccess;
      const userId = isAdminAccess ? null : req.user.id; // Admin can access any transaction

      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Transaction ID is required'
        });
      }

      const result = await this.transactionHistoryService.getTransactionById(id, userId);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.json(result);
    } catch (error) {
      console.error('[Transaction History Controller] Get by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve transaction',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Search transactions
   * POST /api/wallet/search-transactions
   */
  async searchTransactions(req, res) {
    try {
      // Admin access check
      const isAdminAccess = req.body.adminAccess;
      const userId = isAdminAccess ? req.body.userId : req.user.id;

      const {
        query,
        filters,
        limit,
        offset,
        page
      } = req.body;

      // Calculate offset from page if provided
      const calculatedOffset = page ? (parseInt(page) - 1) * (parseInt(limit) || 50) : parseInt(offset) || 0;

      const searchCriteria = {
        userId,
        query,
        filters: filters || {},
        limit: limit ? parseInt(limit) : undefined,
        offset: calculatedOffset
      };

      const result = await this.transactionHistoryService.searchTransactions(searchCriteria);

      res.json(result);
    } catch (error) {
      console.error('[Transaction History Controller] Search error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search transactions',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get transaction summary
   * GET /api/wallet/summary
   */
  async getTransactionSummary(req, res) {
    try {
      // Admin access check
      const isAdminAccess = req.query.adminAccess === 'true' || req.adminAccess;
      const userId = isAdminAccess ? req.query.userId : req.user.id;

      const { period } = req.query;

      const result = await this.transactionHistoryService.getTransactionSummary(userId, period);

      res.json(result);
    } catch (error) {
      console.error('[Transaction History Controller] Get summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve transaction summary',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Export transaction history
   * GET /api/wallet/export
   */
  async exportTransactionHistory(req, res) {
    try {
      // Admin access check
      const isAdminAccess = req.query.adminAccess === 'true' || req.adminAccess;
      const userId = isAdminAccess ? req.query.userId : req.user.id;

      const {
        currency,
        type,
        status,
        startDate,
        endDate,
        format = 'csv'
      } = req.query;

      const filters = {
        userId,
        currency,
        type,
        status,
        startDate,
        endDate,
        limit: 10000 // Large limit for export
      };

      const result = await this.transactionHistoryService.getTransactionHistory(filters);

      if (!result.success) {
        return res.status(400).json(result);
      }

      if (format.toLowerCase() === 'csv') {
        return this.exportAsCSV(res, result.transactions, filters);
      } else if (format.toLowerCase() === 'json') {
        return this.exportAsJSON(res, result.transactions, filters);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Unsupported export format. Use csv or json.'
        });
      }
    } catch (error) {
      console.error('[Transaction History Controller] Export error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export transaction history',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get service configuration
   * GET /api/wallet/config
   */
  async getConfiguration(req, res) {
    try {
      const config = this.transactionHistoryService.getConfiguration();

      res.json({
        success: true,
        configuration: config
      });
    } catch (error) {
      console.error('[Transaction History Controller] Get config error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve configuration',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Export transactions as CSV
   * @private
   */
  exportAsCSV(res, transactions, filters) {
    try {
      // CSV headers
      const headers = [
        'ID',
        'Date',
        'Type',
        'Amount',
        'Currency',
        'Status',
        'Reference',
        'Gateway Reference',
        'Description'
      ];

      // Generate CSV content
      let csvContent = headers.join(',') + '\n';

      transactions.forEach(tx => {
        const row = [
          tx.id,
          new Date(tx.created_at).toISOString(),
          tx.type,
          tx.amount,
          tx.currency,
          tx.status,
          tx.reference || '',
          tx.gateway_reference || '',
          `"${(tx.description || '').replace(/"/g, '""')}"`
        ];
        csvContent += row.join(',') + '\n';
      });

      // Set response headers
      const filename = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      res.send(csvContent);
    } catch (error) {
      console.error('[Transaction History Controller] CSV export error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export as CSV'
      });
    }
  }

  /**
   * Export transactions as JSON
   * @private
   */
  exportAsJSON(res, transactions, filters) {
    try {
      const exportData = {
        exportDate: new Date().toISOString(),
        filters,
        transactionCount: transactions.length,
        transactions
      };

      const filename = `transactions_${new Date().toISOString().split('T')[0]}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      res.json(exportData);
    } catch (error) {
      console.error('[Transaction History Controller] JSON export error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export as JSON'
      });
    }
  }
}

module.exports = new TransactionHistoryController();