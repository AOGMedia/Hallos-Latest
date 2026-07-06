const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { Op } = require('sequelize');

/**
 * Log a transaction
 * @param {object} params - Transaction parameters
 * @returns {object} - Created transaction
 */
async function logTransaction({
  userId,
  transactionType,
  amount,
  currency = 'NGN',
  referenceType = null,
  referenceId = null,
  description = '',
  metadata = {}
}) {
  try {
    const transaction = await Transaction.create({
      userId,
      transactionType,
      amount,
      currency,
      referenceType,
      referenceId,
      description,
      metadata
    });

    return transaction;
  } catch (error) {
    console.error('Log transaction error:', error);
    throw error;
  }
}

/**
 * Get transaction history with filters
 * @param {object} params - Filter parameters
 * @returns {object} - Transactions with pagination
 */
async function getTransactionHistory({
  userId = null,
  transactionType = null,
  startDate = null,
  endDate = null,
  limit = 50,
  offset = 0
}) {
  try {
    const whereClause = {};

    // Filter by user
    if (userId) {
      whereClause.userId = userId;
    }

    // Filter by transaction type
    if (transactionType && ['purchase', 'payout', 'fee'].includes(transactionType)) {
      whereClause.transactionType = transactionType;
    }

    // Filter by date range
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereClause.createdAt[Op.lte] = new Date(endDate);
      }
    }

    const transactions = await Transaction.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return {
      total: transactions.count,
      transactions: transactions.rows,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };
  } catch (error) {
    console.error('Get transaction history error:', error);
    throw error;
  }
}

/**
 * Get transaction statistics for a user
 * @param {number} userId - User ID
 * @returns {object} - Transaction statistics
 */
async function getTransactionStats(userId) {
  try {
    const transactions = await Transaction.findAll({
      where: { userId },
      attributes: ['transactionType', 'amount', 'currency']
    });

    const stats = {
      totalTransactions: transactions.length,
      totalPurchases: 0,
      totalPayouts: 0,
      totalFees: 0,
      purchaseAmount: 0,
      payoutAmount: 0,
      feeAmount: 0
    };

    transactions.forEach(transaction => {
      const amount = parseFloat(transaction.amount);
      
      switch (transaction.transactionType) {
        case 'purchase':
          stats.totalPurchases++;
          stats.purchaseAmount += amount;
          break;
        case 'payout':
          stats.totalPayouts++;
          stats.payoutAmount += amount;
          break;
        case 'fee':
          stats.totalFees++;
          stats.feeAmount += amount;
          break;
      }
    });

    return stats;
  } catch (error) {
    console.error('Get transaction stats error:', error);
    throw error;
  }
}

/**
 * Get recent transactions for a user
 * @param {number} userId - User ID
 * @param {number} limit - Number of transactions to return
 * @returns {array} - Recent transactions
 */
async function getRecentTransactions(userId, limit = 10) {
  try {
    const transactions = await Transaction.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    return transactions;
  } catch (error) {
    console.error('Get recent transactions error:', error);
    throw error;
  }
}

/**
 * Export transactions to CSV format
 * @param {object} params - Filter parameters
 * @returns {string} - CSV string
 */
async function exportTransactionsToCSV({
  userId = null,
  transactionType = null,
  startDate = null,
  endDate = null
}) {
  try {
    const whereClause = {};

    if (userId) whereClause.userId = userId;
    if (transactionType) whereClause.transactionType = transactionType;
    
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
      if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
    }

    const transactions = await Transaction.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Create CSV header
    let csv = 'Transaction ID,User ID,User Name,User Email,Type,Amount,Currency,Description,Date\n';

    // Add transaction rows
    transactions.forEach(transaction => {
      const userName = transaction.user 
        ? `${transaction.user.firstname} ${transaction.user.lastname}`
        : 'N/A';
      const userEmail = transaction.user ? transaction.user.email : 'N/A';
      
      csv += `${transaction.id},`;
      csv += `${transaction.userId},`;
      csv += `"${userName}",`;
      csv += `${userEmail},`;
      csv += `${transaction.transactionType},`;
      csv += `${transaction.amount},`;
      csv += `${transaction.currency},`;
      csv += `"${transaction.description || ''}",`;
      csv += `${transaction.createdAt.toISOString()}\n`;
    });

    return csv;
  } catch (error) {
    console.error('Export transactions error:', error);
    throw error;
  }
}

module.exports = {
  logTransaction,
  getTransactionHistory,
  getTransactionStats,
  getRecentTransactions,
  exportTransactionsToCSV
};
