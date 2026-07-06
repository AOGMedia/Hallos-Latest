const FraudDetectionService = require('../services/fraudDetectionService');

/**
 * Fraud Detection Middleware
 * 
 * Integrates fraud detection with financial operations
 */

// Create singleton instance
const fraudDetectionService = new FraudDetectionService();

/**
 * Create fraud detection middleware for financial operations
 * @param {string} operationType - Type of operation (payment, withdrawal, transfer, etc.)
 * @returns {Function} Express middleware function
 */
function createFraudDetectionMiddleware(operationType) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      
      // Extract transaction details from request
      const transactionDetails = extractTransactionDetails(req.body, operationType);
      
      if (!transactionDetails.amount || transactionDetails.amount <= 0) {
        // Skip fraud detection for zero-amount or invalid transactions
        return next();
      }

      console.log(`[Fraud Detection Middleware] Analyzing ${operationType} for user ${userId}`);

      // Analyze transaction for fraud
      const analysis = await fraudDetectionService.analyzeTransaction({
        userId,
        amount: transactionDetails.amount,
        currency: transactionDetails.currency || 'NGN',
        type: operationType,
        timestamp: Date.now(),
        metadata: {
          ip: clientIP,
          userAgent,
          ...transactionDetails.metadata
        }
      });

      // Add fraud analysis to request for logging
      req.fraudAnalysis = analysis;

      // Handle fraud detection result
      if (!analysis.allowed) {
        console.warn(`[Fraud Detection Middleware] Transaction blocked for user ${userId}:`, analysis);
        
        return res.status(403).json({
          success: false,
          message: analysis.reason,
          riskScore: analysis.riskScore,
          action: analysis.action,
          flags: analysis.flags,
          type: 'fraud_detection_block'
        });
      }

      // Add risk information to response headers
      res.set({
        'X-Risk-Score': analysis.riskScore.toString(),
        'X-Risk-Action': analysis.action,
        'X-Risk-Flags': analysis.flags.join(',')
      });

      // Log high-risk transactions
      if (analysis.riskScore >= 60) {
        console.warn(`[Fraud Detection Middleware] High-risk transaction allowed for user ${userId}:`, {
          riskScore: analysis.riskScore,
          flags: analysis.flags,
          amount: transactionDetails.amount,
          currency: transactionDetails.currency
        });
      }

      next();
    } catch (error) {
      console.error('[Fraud Detection Middleware] Error:', error);
      // On error, allow transaction to proceed but log the issue
      req.fraudAnalysis = {
        allowed: true,
        riskScore: 0,
        reason: 'Fraud detection error - defaulting to allow',
        action: 'allow',
        flags: ['middleware_error'],
        error: error.message
      };
      next();
    }
  };
}

/**
 * Extract transaction details from request body
 * @param {Object} body - Request body
 * @param {string} operationType - Operation type
 * @returns {Object} Transaction details
 */
function extractTransactionDetails(body, operationType) {
  const details = {
    amount: 0,
    currency: 'NGN',
    metadata: {}
  };

  if (!body) return details;

  // Extract amount (try different field names)
  const amountFields = ['amount', 'value', 'total', 'sum', 'price'];
  for (const field of amountFields) {
    if (body[field] !== undefined) {
      const amount = parseFloat(body[field]);
      if (!isNaN(amount) && amount > 0) {
        details.amount = amount;
        break;
      }
    }
  }

  // Extract currency
  if (body.currency) {
    details.currency = body.currency.toUpperCase();
  }

  // Extract operation-specific metadata
  switch (operationType) {
    case 'payment':
      details.metadata = {
        contentType: body.contentType,
        contentId: body.contentId,
        gateway: body.gateway
      };
      break;
      
    case 'transfer':
      details.metadata = {
        toUserId: body.toUserId,
        fromUserId: body.fromUserId,
        description: body.description
      };
      break;
      
    case 'withdrawal':
      details.metadata = {
        bankAccount: body.bankAccount,
        withdrawalMethod: body.method
      };
      break;
      
    case 'deposit':
      details.metadata = {
        depositMethod: body.method,
        reference: body.reference
      };
      break;
      
    default:
      details.metadata = {
        operationType,
        reference: body.reference,
        description: body.description
      };
  }

  return details;
}

/**
 * Middleware for different operation types
 */
const fraudDetectionMiddleware = {
  // Specific operation middlewares
  payments: createFraudDetectionMiddleware('payment'),
  withdrawals: createFraudDetectionMiddleware('withdrawal'),
  deposits: createFraudDetectionMiddleware('deposit'),
  transfers: createFraudDetectionMiddleware('transfer'),
  walletOperations: createFraudDetectionMiddleware('wallet_operation'),
  
  // Custom middleware creator
  createCustomMiddleware: createFraudDetectionMiddleware,
  
  // Direct access to service for advanced usage
  service: fraudDetectionService
};

module.exports = fraudDetectionMiddleware;