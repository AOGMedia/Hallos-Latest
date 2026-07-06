const AuditTrailService = require('../services/auditTrailService');

/**
 * Audit Middleware
 * 
 * Automatically logs audit events for financial operations
 */

// Create singleton instance
const auditTrailService = new AuditTrailService();

/**
 * Create audit middleware for specific event types
 * @param {string} eventType - Type of event to log
 * @param {Function} dataExtractor - Function to extract audit data from request
 * @returns {Function} Express middleware function
 */
function createAuditMiddleware(eventType, dataExtractor = null) {
  return async (req, res, next) => {
    // Store original res.json to intercept response
    const originalJson = res.json;
    
    res.json = function(data) {
      // Log audit event after response
      setImmediate(async () => {
        try {
          const userId = req.user?.id;
          const sessionId = req.sessionID || req.headers['x-session-id'];
          const ipAddress = req.ip || req.connection.remoteAddress;
          const userAgent = req.get('User-Agent');

          // Extract audit data
          let auditData = {};
          if (dataExtractor && typeof dataExtractor === 'function') {
            auditData = dataExtractor(req, data);
          } else {
            auditData = extractDefaultAuditData(req, data);
          }

          // Log the event
          await auditTrailService.logEvent({
            eventType,
            userId,
            sessionId,
            ipAddress,
            userAgent,
            data: auditData,
            metadata: {
              method: req.method,
              url: req.originalUrl,
              statusCode: res.statusCode,
              success: data?.success !== false
            }
          });
        } catch (error) {
          console.error('[Audit Middleware] Logging error:', error);
          // Don't fail the request if audit logging fails
        }
      });

      // Call original json method
      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Extract default audit data from request and response
 * @param {Object} req - Express request object
 * @param {Object} responseData - Response data
 * @returns {Object} Audit data
 */
function extractDefaultAuditData(req, responseData) {
  const auditData = {
    method: req.method,
    url: req.originalUrl,
    success: responseData?.success !== false
  };

  // Extract relevant fields from request body
  if (req.body) {
    const { password, token, otp, ...safeBody } = req.body;
    auditData.requestData = safeBody;
  }

  // Extract relevant fields from response
  if (responseData) {
    const { 
      success, 
      message, 
      amount, 
      currency, 
      reference, 
      withdrawalId,
      paymentId,
      transferId 
    } = responseData;
    
    auditData.responseData = {
      success,
      message,
      amount,
      currency,
      reference,
      withdrawalId,
      paymentId,
      transferId
    };
  }

  return auditData;
}

/**
 * Specific audit middlewares for different operations
 */
const auditMiddleware = {
  // Financial operations
  paymentInitiated: createAuditMiddleware('payment_initiated', (req, res) => ({
    amount: req.body.amount,
    currency: req.body.currency,
    contentType: req.body.contentType,
    contentId: req.body.contentId,
    gateway: req.body.gateway,
    reference: res.reference || req.body.reference
  })),

  paymentCompleted: createAuditMiddleware('payment_completed', (req, res) => ({
    amount: res.amount || req.body.amount,
    currency: res.currency || req.body.currency,
    reference: res.reference || req.body.reference,
    gateway: res.gateway,
    transactionId: res.transactionId
  })),

  withdrawalInitiated: createAuditMiddleware('withdrawal_initiated', (req, res) => ({
    amount: req.body.amount,
    currency: req.body.currency,
    bankAccount: req.body.bankAccount ? 'REDACTED' : null,
    reference: res.reference || req.body.reference,
    withdrawalId: res.withdrawalId
  })),

  withdrawalCompleted: createAuditMiddleware('withdrawal_completed', (req, res) => ({
    amount: res.amount || req.body.amount,
    currency: res.currency || req.body.currency,
    reference: res.reference || req.body.reference,
    withdrawalId: res.withdrawalId,
    gateway: res.gateway
  })),

  transferInitiated: createAuditMiddleware('transfer_initiated', (req, res) => ({
    amount: req.body.amount,
    currency: req.body.currency,
    fromUserId: req.user?.id,
    toUserId: req.body.toUserId,
    description: req.body.description,
    reference: res.reference || req.body.reference
  })),

  walletCredited: createAuditMiddleware('wallet_credited', (req, res) => ({
    amount: req.body.amount,
    currency: req.body.currency,
    reason: req.body.description || req.body.reason,
    reference: res.reference || req.body.reference
  })),

  walletDebited: createAuditMiddleware('wallet_debited', (req, res) => ({
    amount: req.body.amount,
    currency: req.body.currency,
    reason: req.body.description || req.body.reason,
    reference: res.reference || req.body.reference
  })),

  // Security operations
  loginSuccess: createAuditMiddleware('login_success', (req, res) => ({
    email: req.body.email,
    loginMethod: req.body.loginMethod || 'password'
  })),

  loginFailed: createAuditMiddleware('login_failed', (req, res) => ({
    email: req.body.email,
    reason: res.message || 'Invalid credentials',
    loginMethod: req.body.loginMethod || 'password'
  })),

  passwordChanged: createAuditMiddleware('password_changed', (req, res) => ({
    method: req.body.resetToken ? 'reset' : 'change'
  })),

  fraudDetected: createAuditMiddleware('fraud_detected', (req, res) => ({
    riskScore: req.fraudAnalysis?.riskScore,
    flags: req.fraudAnalysis?.flags,
    action: req.fraudAnalysis?.action,
    amount: req.body.amount,
    currency: req.body.currency
  })),

  suspiciousActivity: createAuditMiddleware('suspicious_activity', (req, res) => ({
    activityType: req.body.activityType,
    details: req.body.details,
    riskLevel: req.body.riskLevel
  })),

  // System operations
  rateLimitExceeded: createAuditMiddleware('rate_limit_exceeded', (req, res) => ({
    endpoint: req.originalUrl,
    limit: req.rateLimit?.limit,
    remaining: req.rateLimit?.remaining,
    resetTime: req.rateLimit?.resetTime
  })),

  // Admin operations
  userSuspended: createAuditMiddleware('user_suspended', (req, res) => ({
    targetUserId: req.body.userId || req.params.userId,
    reason: req.body.reason,
    adminUserId: req.user?.id
  })),

  limitsChanged: createAuditMiddleware('limits_changed', (req, res) => ({
    targetUserId: req.body.userId || req.params.userId,
    limitType: req.body.limitType,
    oldLimits: req.body.oldLimits,
    newLimits: req.body.newLimits,
    adminUserId: req.user?.id
  })),

  // Generic middleware creator
  createCustomMiddleware: createAuditMiddleware,
  
  // Direct access to service
  service: auditTrailService
};

module.exports = auditMiddleware;