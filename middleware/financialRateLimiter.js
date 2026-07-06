const { idempotencyService } = require('../services/idempotencyService');

/**
 * Financial Rate Limiting Middleware
 * 
 * Provides specialized rate limiting for financial operations with:
 * - Per-user and per-IP rate limiting
 * - Operation-specific limits (deposits, withdrawals, transfers)
 * - Progressive penalties for violations
 * - Suspicious activity detection
 * - Admin override capabilities
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

class FinancialRateLimiter {
  constructor() {
    this.idempotencyService = idempotencyService;
    
    // Rate limiting configuration
    this.config = {
      // Per-user limits (per hour)
      userLimits: {
        deposits: { count: 10, amount: 50000 }, // 10 deposits, max 50k total per hour
        withdrawals: { count: 5, amount: 20000 }, // 5 withdrawals, max 20k total per hour
        transfers: { count: 20, amount: 100000 }, // 20 transfers, max 100k total per hour
        payments: { count: 50, amount: 200000 }, // 50 payments, max 200k total per hour
        wallet_operations: { count: 100, amount: 500000 } // All operations combined
      },
      
      // Per-IP limits (per hour) - more restrictive
      ipLimits: {
        deposits: { count: 50, amount: 500000 },
        withdrawals: { count: 25, amount: 200000 },
        transfers: { count: 100, amount: 1000000 },
        payments: { count: 200, amount: 2000000 },
        wallet_operations: { count: 500, amount: 5000000 }
      },
      
      // Time windows
      windowSize: 60 * 60 * 1000, // 1 hour in milliseconds
      cleanupInterval: 10 * 60 * 1000, // Cleanup every 10 minutes
      
      // Progressive penalties
      violationPenalties: {
        1: 2 * 60 * 1000,    // 2 minutes for first violation
        2: 5 * 60 * 1000,    // 5 minutes for second violation
        3: 15 * 60 * 1000,   // 15 minutes for third violation
        4: 60 * 60 * 1000,   // 1 hour for fourth violation
        5: 24 * 60 * 60 * 1000 // 24 hours for fifth+ violation
      }
    };

    // In-memory stores (in production, use Redis)
    this.userActivity = new Map(); // User activity tracking
    this.ipActivity = new Map();   // IP activity tracking
    this.violations = new Map();   // Violation tracking
    this.blockedUsers = new Map(); // Temporarily blocked users
    this.blockedIPs = new Map();   // Temporarily blocked IPs
    
    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Create rate limiting middleware for specific operation
   * @param {string} operationType - Type of operation (deposits, withdrawals, etc.)
   * @param {Object} customLimits - Optional custom limits for this operation
   * @returns {Function} Express middleware function
   */
  createMiddleware(operationType, customLimits = {}) {
    return async (req, res, next) => {
      try {
        const userId = req.user?.id;
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        const amount = this.extractAmount(req.body);
        
        console.log(`[Financial Rate Limiter] Checking ${operationType} for user ${userId}, IP ${clientIP}, amount: ${amount}`);

        // Check if user or IP is temporarily blocked
        const blockCheck = this.checkTemporaryBlocks(userId, clientIP);
        if (!blockCheck.allowed) {
          return res.status(429).json({
            success: false,
            message: blockCheck.message,
            retryAfter: blockCheck.retryAfter,
            type: 'rate_limit_exceeded'
          });
        }

        // Check rate limits
        const rateLimitResult = await this.checkRateLimits({
          userId,
          clientIP,
          operationType,
          amount: amount || 0,
          customLimits
        });

        if (!rateLimitResult.allowed) {
          // Apply progressive penalty
          await this.applyViolationPenalty(userId, clientIP, operationType);
          
          return res.status(429).json({
            success: false,
            message: rateLimitResult.message,
            limits: rateLimitResult.limits,
            current: rateLimitResult.current,
            retryAfter: rateLimitResult.retryAfter,
            type: 'rate_limit_exceeded'
          });
        }

        // Record the operation
        await this.recordOperation({
          userId,
          clientIP,
          operationType,
          amount: amount || 0
        });

        // Add rate limit info to response headers
        res.set({
          'X-RateLimit-Limit-Count': rateLimitResult.limits.count,
          'X-RateLimit-Limit-Amount': rateLimitResult.limits.amount,
          'X-RateLimit-Remaining-Count': rateLimitResult.remaining.count,
          'X-RateLimit-Remaining-Amount': rateLimitResult.remaining.amount,
          'X-RateLimit-Reset': rateLimitResult.resetTime
        });

        next();
      } catch (error) {
        console.error('[Financial Rate Limiter] Middleware error:', error);
        // On error, allow request to proceed but log the issue
        next();
      }
    };
  }

  /**
   * Check rate limits for user and IP
   * @param {Object} params - Check parameters
   * @returns {Promise<Object>} Rate limit result
   */
  async checkRateLimits({ userId, clientIP, operationType, amount, customLimits }) {
    const now = Date.now();
    const windowStart = now - this.config.windowSize;

    // Get limits (custom or default)
    const userLimits = customLimits.userLimits || this.config.userLimits[operationType] || this.config.userLimits.wallet_operations;
    const ipLimits = customLimits.ipLimits || this.config.ipLimits[operationType] || this.config.ipLimits.wallet_operations;

    // Initialize userCheck outside the if block
    let userCheck = null;

    // Check user limits
    if (userId) {
      userCheck = this.checkUserLimits(userId, operationType, amount, userLimits, windowStart);
      if (!userCheck.allowed) {
        return {
          allowed: false,
          message: `User rate limit exceeded for ${operationType}. ${userCheck.reason}`,
          limits: userLimits,
          current: userCheck.current,
          retryAfter: this.config.windowSize,
          type: 'user_limit'
        };
      }
    }

    // Check IP limits
    const ipCheck = this.checkIPLimits(clientIP, operationType, amount, ipLimits, windowStart);
    if (!ipCheck.allowed) {
      return {
        allowed: false,
        message: `IP rate limit exceeded for ${operationType}. ${ipCheck.reason}`,
        limits: ipLimits,
        current: ipCheck.current,
        retryAfter: this.config.windowSize,
        type: 'ip_limit'
      };
    }

    // Return success with remaining limits
    return {
      allowed: true,
      limits: userLimits,
      remaining: {
        count: userLimits.count - (userCheck?.current?.count || 0),
        amount: userLimits.amount - (userCheck?.current?.amount || 0)
      },
      resetTime: windowStart + this.config.windowSize
    };
  }

  /**
   * Check user-specific rate limits
   * @param {number} userId - User ID
   * @param {string} operationType - Operation type
   * @param {number} amount - Transaction amount
   * @param {Object} limits - Rate limits
   * @param {number} windowStart - Window start time
   * @returns {Object} Check result
   */
  checkUserLimits(userId, operationType, amount, limits, windowStart) {
    const userKey = `user:${userId}`;
    
    if (!this.userActivity.has(userKey)) {
      this.userActivity.set(userKey, {});
    }

    const userOps = this.userActivity.get(userKey);
    
    if (!userOps[operationType]) {
      userOps[operationType] = [];
    }

    // Filter operations within window
    const recentOps = userOps[operationType].filter(op => op.timestamp > windowStart);
    
    // Calculate current usage
    const currentCount = recentOps.length;
    const currentAmount = recentOps.reduce((sum, op) => sum + op.amount, 0);

    // Check limits
    if (currentCount >= limits.count) {
      return {
        allowed: false,
        reason: `Maximum ${limits.count} operations per hour exceeded`,
        current: { count: currentCount, amount: currentAmount }
      };
    }

    if (currentAmount + amount > limits.amount) {
      return {
        allowed: false,
        reason: `Maximum amount ${limits.amount} per hour exceeded`,
        current: { count: currentCount, amount: currentAmount }
      };
    }

    return {
      allowed: true,
      current: { count: currentCount, amount: currentAmount }
    };
  }

  /**
   * Check IP-specific rate limits
   * @param {string} clientIP - Client IP
   * @param {string} operationType - Operation type
   * @param {number} amount - Transaction amount
   * @param {Object} limits - Rate limits
   * @param {number} windowStart - Window start time
   * @returns {Object} Check result
   */
  checkIPLimits(clientIP, operationType, amount, limits, windowStart) {
    const ipKey = `ip:${clientIP}`;
    
    if (!this.ipActivity.has(ipKey)) {
      this.ipActivity.set(ipKey, {});
    }

    const ipOps = this.ipActivity.get(ipKey);
    
    if (!ipOps[operationType]) {
      ipOps[operationType] = [];
    }

    // Filter operations within window
    const recentOps = ipOps[operationType].filter(op => op.timestamp > windowStart);
    
    // Calculate current usage
    const currentCount = recentOps.length;
    const currentAmount = recentOps.reduce((sum, op) => sum + op.amount, 0);

    // Check limits
    if (currentCount >= limits.count) {
      return {
        allowed: false,
        reason: `Maximum ${limits.count} operations per hour exceeded for IP`,
        current: { count: currentCount, amount: currentAmount }
      };
    }

    if (currentAmount + amount > limits.amount) {
      return {
        allowed: false,
        reason: `Maximum amount ${limits.amount} per hour exceeded for IP`,
        current: { count: currentCount, amount: currentAmount }
      };
    }

    return {
      allowed: true,
      current: { count: currentCount, amount: currentAmount }
    };
  }

  /**
   * Record successful operation
   * @param {Object} params - Operation parameters
   */
  async recordOperation({ userId, clientIP, operationType, amount }) {
    const now = Date.now();
    const operation = { timestamp: now, amount };

    // Record for user
    if (userId) {
      const userKey = `user:${userId}`;
      if (!this.userActivity.has(userKey)) {
        this.userActivity.set(userKey, {});
      }
      const userOps = this.userActivity.get(userKey);
      if (!userOps[operationType]) {
        userOps[operationType] = [];
      }
      userOps[operationType].push(operation);
    }

    // Record for IP
    const ipKey = `ip:${clientIP}`;
    if (!this.ipActivity.has(ipKey)) {
      this.ipActivity.set(ipKey, {});
    }
    const ipOps = this.ipActivity.get(ipKey);
    if (!ipOps[operationType]) {
      ipOps[operationType] = [];
    }
    ipOps[operationType].push(operation);

    console.log(`[Financial Rate Limiter] Recorded ${operationType} for user ${userId}, IP ${clientIP}, amount: ${amount}`);
  }

  /**
   * Check temporary blocks
   * @param {number} userId - User ID
   * @param {string} clientIP - Client IP
   * @returns {Object} Block check result
   */
  checkTemporaryBlocks(userId, clientIP) {
    const now = Date.now();

    // Check user block
    if (userId && this.blockedUsers.has(userId)) {
      const blockInfo = this.blockedUsers.get(userId);
      if (now < blockInfo.until) {
        return {
          allowed: false,
          message: `User temporarily blocked due to rate limit violations. Try again later.`,
          retryAfter: Math.ceil((blockInfo.until - now) / 1000)
        };
      } else {
        // Block expired, remove it
        this.blockedUsers.delete(userId);
      }
    }

    // Check IP block
    if (this.blockedIPs.has(clientIP)) {
      const blockInfo = this.blockedIPs.get(clientIP);
      if (now < blockInfo.until) {
        return {
          allowed: false,
          message: `IP temporarily blocked due to rate limit violations. Try again later.`,
          retryAfter: Math.ceil((blockInfo.until - now) / 1000)
        };
      } else {
        // Block expired, remove it
        this.blockedIPs.delete(clientIP);
      }
    }

    return { allowed: true };
  }

  /**
   * Apply progressive penalty for rate limit violation
   * @param {number} userId - User ID
   * @param {string} clientIP - Client IP
   * @param {string} operationType - Operation type
   */
  async applyViolationPenalty(userId, clientIP, operationType) {
    const now = Date.now();

    // Track violations for user
    if (userId) {
      const userViolationKey = `user:${userId}`;
      const userViolations = this.violations.get(userViolationKey) || 0;
      const newUserViolations = userViolations + 1;
      this.violations.set(userViolationKey, newUserViolations);

      // Apply penalty based on violation count
      const penaltyDuration = this.config.violationPenalties[Math.min(newUserViolations, 5)];
      this.blockedUsers.set(userId, {
        until: now + penaltyDuration,
        violations: newUserViolations,
        reason: `Rate limit violation for ${operationType}`
      });

      console.warn(`[Financial Rate Limiter] User ${userId} blocked for ${penaltyDuration}ms (violation #${newUserViolations})`);
    }

    // Track violations for IP
    const ipViolationKey = `ip:${clientIP}`;
    const ipViolations = this.violations.get(ipViolationKey) || 0;
    const newIPViolations = ipViolations + 1;
    this.violations.set(ipViolationKey, newIPViolations);

    // Apply penalty based on violation count
    const penaltyDuration = this.config.violationPenalties[Math.min(newIPViolations, 5)];
    this.blockedIPs.set(clientIP, {
      until: now + penaltyDuration,
      violations: newIPViolations,
      reason: `Rate limit violation for ${operationType}`
    });

    console.warn(`[Financial Rate Limiter] IP ${clientIP} blocked for ${penaltyDuration}ms (violation #${newIPViolations})`);

    // Log suspicious activity if many violations
    if (newUserViolations >= 3 || newIPViolations >= 5) {
      this.logSuspiciousActivity(userId, clientIP, operationType, {
        userViolations: newUserViolations,
        ipViolations: newIPViolations
      });
    }
  }

  /**
   * Extract amount from request body
   * @param {Object} body - Request body
   * @returns {number} Amount or 0
   */
  extractAmount(body) {
    if (!body) return 0;
    
    // Try different common field names
    const amountFields = ['amount', 'value', 'total', 'sum'];
    
    for (const field of amountFields) {
      if (body[field] !== undefined) {
        const amount = parseFloat(body[field]);
        return isNaN(amount) ? 0 : Math.abs(amount);
      }
    }
    
    return 0;
  }

  /**
   * Log suspicious activity
   * @param {number} userId - User ID
   * @param {string} clientIP - Client IP
   * @param {string} operationType - Operation type
   * @param {Object} details - Additional details
   */
  logSuspiciousActivity(userId, clientIP, operationType, details) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'financial_rate_limit_violation',
      userId,
      clientIP,
      operationType,
      details,
      severity: 'high'
    };

    console.error('[Financial Rate Limiter] Suspicious activity detected:', logEntry);

    // In production, send to security monitoring system
    // this.securityMonitor.alert(logEntry);
  }

  /**
   * Start cleanup interval to remove old data
   */
  startCleanupInterval() {
    setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up old activity data
   */
  cleanup() {
    const now = Date.now();
    const cutoff = now - this.config.windowSize;

    console.log('[Financial Rate Limiter] Starting cleanup...');

    // Clean user activity
    for (const [userKey, operations] of this.userActivity.entries()) {
      for (const [opType, ops] of Object.entries(operations)) {
        const recentOps = ops.filter(op => op.timestamp > cutoff);
        if (recentOps.length === 0) {
          delete operations[opType];
        } else {
          operations[opType] = recentOps;
        }
      }
      
      // Remove user if no operations
      if (Object.keys(operations).length === 0) {
        this.userActivity.delete(userKey);
      }
    }

    // Clean IP activity
    for (const [ipKey, operations] of this.ipActivity.entries()) {
      for (const [opType, ops] of Object.entries(operations)) {
        const recentOps = ops.filter(op => op.timestamp > cutoff);
        if (recentOps.length === 0) {
          delete operations[opType];
        } else {
          operations[opType] = recentOps;
        }
      }
      
      // Remove IP if no operations
      if (Object.keys(operations).length === 0) {
        this.ipActivity.delete(ipKey);
      }
    }

    // Clean expired blocks
    for (const [userId, blockInfo] of this.blockedUsers.entries()) {
      if (now >= blockInfo.until) {
        this.blockedUsers.delete(userId);
      }
    }

    for (const [clientIP, blockInfo] of this.blockedIPs.entries()) {
      if (now >= blockInfo.until) {
        this.blockedIPs.delete(clientIP);
      }
    }

    console.log(`[Financial Rate Limiter] Cleanup completed. Active users: ${this.userActivity.size}, Active IPs: ${this.ipActivity.size}`);
  }

  /**
   * Get rate limiting statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    return {
      activeUsers: this.userActivity.size,
      activeIPs: this.ipActivity.size,
      blockedUsers: this.blockedUsers.size,
      blockedIPs: this.blockedIPs.size,
      totalViolations: this.violations.size,
      config: {
        windowSize: this.config.windowSize,
        userLimits: this.config.userLimits,
        ipLimits: this.config.ipLimits
      }
    };
  }

  /**
   * Admin function: Unblock user
   * @param {number} userId - User ID to unblock
   */
  unblockUser(userId) {
    this.blockedUsers.delete(userId);
    this.violations.delete(`user:${userId}`);
    console.log(`[Financial Rate Limiter] User ${userId} unblocked by admin`);
  }

  /**
   * Admin function: Unblock IP
   * @param {string} clientIP - IP to unblock
   */
  unblockIP(clientIP) {
    this.blockedIPs.delete(clientIP);
    this.violations.delete(`ip:${clientIP}`);
    console.log(`[Financial Rate Limiter] IP ${clientIP} unblocked by admin`);
  }
}

// Create singleton instance
const financialRateLimiter = new FinancialRateLimiter();

// Export middleware functions for different operations
module.exports = {
  FinancialRateLimiter,
  
  // Middleware for specific operations
  deposits: financialRateLimiter.createMiddleware('deposits'),
  withdrawals: financialRateLimiter.createMiddleware('withdrawals'),
  transfers: financialRateLimiter.createMiddleware('transfers'),
  payments: financialRateLimiter.createMiddleware('payments'),
  walletOperations: financialRateLimiter.createMiddleware('wallet_operations'),
  
  // Custom middleware creator
  createCustomMiddleware: (operationType, customLimits) => 
    financialRateLimiter.createMiddleware(operationType, customLimits),
  
  // Admin functions
  getStatistics: () => financialRateLimiter.getStatistics(),
  unblockUser: (userId) => financialRateLimiter.unblockUser(userId),
  unblockIP: (clientIP) => financialRateLimiter.unblockIP(clientIP),
  
  // Direct access to instance for advanced usage
  instance: financialRateLimiter
};