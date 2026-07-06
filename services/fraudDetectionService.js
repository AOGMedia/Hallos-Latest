const { idempotencyService } = require('./idempotencyService');

/**
 * Fraud Detection Engine
 * 
 * Provides comprehensive fraud detection with:
 * - Transaction velocity monitoring
 * - User behavior baseline tracking
 * - Automatic flagging for suspicious patterns
 * - Risk scoring and threshold management
 * - Real-time alerts and blocking
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

class FraudDetectionService {
  constructor() {
    this.idempotencyService = idempotencyService;
    
    // Fraud detection configuration
    this.config = {
      // Velocity thresholds (per hour)
      velocityThresholds: {
        transactions: {
          count: 50,        // Max 50 transactions per hour
          amount: 1000000   // Max 1M total amount per hour
        },
        deposits: {
          count: 20,        // Max 20 deposits per hour
          amount: 500000    // Max 500k deposits per hour
        },
        withdrawals: {
          count: 10,        // Max 10 withdrawals per hour
          amount: 200000    // Max 200k withdrawals per hour
        }
      },
      
      // Behavioral analysis windows
      behaviorWindows: {
        short: 1 * 60 * 60 * 1000,      // 1 hour
        medium: 24 * 60 * 60 * 1000,    // 24 hours
        long: 7 * 24 * 60 * 60 * 1000   // 7 days
      },
      
      // Risk scoring thresholds
      riskThresholds: {
        low: 30,      // 0-30: Low risk
        medium: 60,   // 31-60: Medium risk
        high: 80,     // 61-80: High risk
        critical: 100 // 81-100: Critical risk
      },
      
      // Suspicious patterns
      suspiciousPatterns: {
        rapidSuccession: 5 * 60 * 1000,     // 5 minutes between transactions
        roundAmounts: [1000, 5000, 10000, 50000, 100000], // Suspicious round amounts
        timePatterns: {
          nightHours: { start: 23, end: 6 }, // 11 PM to 6 AM
          weekends: [0, 6] // Sunday and Saturday
        }
      },
      
      // Auto-block thresholds
      autoBlockThresholds: {
        riskScore: 85,        // Auto-block at risk score 85+
        velocityMultiplier: 3, // Auto-block at 3x normal velocity
        suspiciousCount: 5     // Auto-block after 5 suspicious activities
      }
    };

    // In-memory stores (in production, use Redis)
    this.userBaselines = new Map();     // User behavior baselines
    this.transactionHistory = new Map(); // Recent transaction history
    this.riskScores = new Map();        // Current risk scores
    this.suspiciousActivity = new Map(); // Suspicious activity tracking
    this.blockedUsers = new Set();      // Auto-blocked users
    this.flaggedTransactions = new Map(); // Flagged transactions
    
    // Start baseline calculation interval
    this.startBaselineCalculation();
  }

  /**
   * Analyze transaction for fraud indicators
   * @param {Object} transaction - Transaction details
   * @returns {Promise<Object>} Fraud analysis result
   */
  async analyzeTransaction(transaction) {
    try {
      const {
        userId,
        amount,
        currency,
        type,
        timestamp = Date.now(),
        metadata = {}
      } = transaction;

      console.log(`[Fraud Detection] Analyzing ${type} transaction for user ${userId}: ${amount} ${currency}`);

      // Check if user is already blocked
      if (this.blockedUsers.has(userId)) {
        return {
          allowed: false,
          riskScore: 100,
          reason: 'User is auto-blocked due to suspicious activity',
          action: 'block',
          flags: ['auto_blocked']
        };
      }

      // Perform fraud analysis
      const analysis = await this.performFraudAnalysis({
        userId,
        amount,
        currency,
        type,
        timestamp,
        metadata
      });

      // Record transaction for future analysis
      await this.recordTransaction(transaction);

      // Update risk score
      await this.updateRiskScore(userId, analysis.riskScore);

      // Check for auto-block conditions
      if (analysis.riskScore >= this.config.autoBlockThresholds.riskScore) {
        await this.autoBlockUser(userId, 'High risk score', analysis);
        analysis.action = 'block';
        analysis.allowed = false;
      }

      console.log(`[Fraud Detection] Analysis complete for user ${userId}: Risk Score ${analysis.riskScore}, Action: ${analysis.action}`);

      return analysis;
    } catch (error) {
      console.error('[Fraud Detection] Analysis error:', error);
      // On error, allow transaction but log the issue
      return {
        allowed: true,
        riskScore: 0,
        reason: 'Analysis error - defaulting to allow',
        action: 'allow',
        flags: ['analysis_error'],
        error: error.message
      };
    }
  }

  /**
   * Perform comprehensive fraud analysis
   * @param {Object} params - Analysis parameters
   * @returns {Promise<Object>} Analysis result
   */
  async performFraudAnalysis({ userId, amount, currency, type, timestamp, metadata }) {
    let riskScore = 0;
    const flags = [];
    const details = {};

    // 1. Velocity Analysis
    const velocityAnalysis = await this.analyzeVelocity(userId, amount, type, timestamp);
    riskScore += velocityAnalysis.riskScore;
    flags.push(...velocityAnalysis.flags);
    details.velocity = velocityAnalysis.details;

    // 2. Behavioral Analysis
    const behaviorAnalysis = await this.analyzeBehavior(userId, amount, type, timestamp);
    riskScore += behaviorAnalysis.riskScore;
    flags.push(...behaviorAnalysis.flags);
    details.behavior = behaviorAnalysis.details;

    // 3. Pattern Analysis
    const patternAnalysis = await this.analyzePatterns(userId, amount, type, timestamp, metadata);
    riskScore += patternAnalysis.riskScore;
    flags.push(...patternAnalysis.flags);
    details.patterns = patternAnalysis.details;

    // 4. Amount Analysis
    const amountAnalysis = await this.analyzeAmount(userId, amount, currency, type);
    riskScore += amountAnalysis.riskScore;
    flags.push(...amountAnalysis.flags);
    details.amount = amountAnalysis.details;

    // 5. Timing Analysis
    const timingAnalysis = await this.analyzeTiming(timestamp);
    riskScore += timingAnalysis.riskScore;
    flags.push(...timingAnalysis.flags);
    details.timing = timingAnalysis.details;

    // Determine action based on risk score
    let action = 'allow';
    let allowed = true;
    let reason = 'Transaction appears legitimate';

    if (riskScore >= this.config.riskThresholds.critical) {
      action = 'block';
      allowed = false;
      reason = 'Critical risk level detected';
    } else if (riskScore >= this.config.riskThresholds.high) {
      action = 'review';
      allowed = false;
      reason = 'High risk - requires manual review';
    } else if (riskScore >= this.config.riskThresholds.medium) {
      action = 'monitor';
      reason = 'Medium risk - enhanced monitoring';
    }

    // Log suspicious activity
    if (riskScore >= this.config.riskThresholds.medium) {
      await this.logSuspiciousActivity(userId, {
        riskScore,
        flags,
        details,
        transaction: { amount, currency, type, timestamp }
      });
    }

    return {
      allowed,
      riskScore: Math.min(riskScore, 100), // Cap at 100
      reason,
      action,
      flags: [...new Set(flags)], // Remove duplicates
      details
    };
  }

  /**
   * Analyze transaction velocity
   * @param {number} userId - User ID
   * @param {number} amount - Transaction amount
   * @param {string} type - Transaction type
   * @param {number} timestamp - Transaction timestamp
   * @returns {Promise<Object>} Velocity analysis
   */
  async analyzeVelocity(userId, amount, type, timestamp) {
    const userHistory = this.getUserTransactionHistory(userId);
    const hourAgo = timestamp - (60 * 60 * 1000);
    
    // Filter recent transactions
    const recentTransactions = userHistory.filter(tx => tx.timestamp > hourAgo);
    const recentOfType = recentTransactions.filter(tx => tx.type === type);
    
    // Calculate current velocity
    const totalCount = recentTransactions.length;
    const totalAmount = recentTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const typeCount = recentOfType.length;
    const typeAmount = recentOfType.reduce((sum, tx) => sum + tx.amount, 0);

    let riskScore = 0;
    const flags = [];
    const details = {
      totalTransactions: totalCount,
      totalAmount,
      typeTransactions: typeCount,
      typeAmount
    };

    // Check general velocity thresholds
    const generalThreshold = this.config.velocityThresholds.transactions;
    if (totalCount >= generalThreshold.count) {
      riskScore += 25;
      flags.push('high_transaction_velocity');
    }
    if (totalAmount >= generalThreshold.amount) {
      riskScore += 25;
      flags.push('high_amount_velocity');
    }

    // Check type-specific thresholds
    const typeThreshold = this.config.velocityThresholds[type];
    if (typeThreshold) {
      if (typeCount >= typeThreshold.count) {
        riskScore += 20;
        flags.push(`high_${type}_velocity`);
      }
      if (typeAmount >= typeThreshold.amount) {
        riskScore += 20;
        flags.push(`high_${type}_amount_velocity`);
      }
    }

    // Check against user baseline
    const baseline = this.getUserBaseline(userId);
    if (baseline) {
      const velocityMultiplier = totalCount / (baseline.avgTransactionsPerHour || 1);
      if (velocityMultiplier >= this.config.autoBlockThresholds.velocityMultiplier) {
        riskScore += 30;
        flags.push('velocity_exceeds_baseline');
        details.velocityMultiplier = velocityMultiplier;
      }
    }

    return { riskScore, flags, details };
  }

  /**
   * Analyze user behavior patterns
   * @param {number} userId - User ID
   * @param {number} amount - Transaction amount
   * @param {string} type - Transaction type
   * @param {number} timestamp - Transaction timestamp
   * @returns {Promise<Object>} Behavior analysis
   */
  async analyzeBehavior(userId, amount, type, timestamp) {
    const baseline = this.getUserBaseline(userId);
    let riskScore = 0;
    const flags = [];
    const details = {};

    if (!baseline) {
      // New user - higher risk
      riskScore += 10;
      flags.push('new_user');
      details.reason = 'No behavioral baseline available';
      return { riskScore, flags, details };
    }

    // Check amount deviation from baseline
    const avgAmount = baseline.avgAmount || 0;
    const amountDeviation = Math.abs(amount - avgAmount) / (avgAmount || 1);
    
    if (amountDeviation > 5) { // 5x deviation
      riskScore += 20;
      flags.push('amount_deviation');
      details.amountDeviation = amountDeviation;
    }

    // Check transaction type frequency
    const typeFrequency = baseline.typeFrequency || {};
    const expectedFrequency = typeFrequency[type] || 0;
    
    if (expectedFrequency < 0.1 && amount > 10000) { // Rare type with high amount
      riskScore += 15;
      flags.push('unusual_type_for_user');
      details.typeFrequency = expectedFrequency;
    }

    // Check time pattern deviation
    const hour = new Date(timestamp).getHours();
    const activeHours = baseline.activeHours || [];
    
    if (activeHours.length > 0 && !activeHours.includes(hour)) {
      riskScore += 10;
      flags.push('unusual_time_pattern');
      details.unusualHour = hour;
    }

    return { riskScore, flags, details };
  }

  /**
   * Analyze suspicious patterns
   * @param {number} userId - User ID
   * @param {number} amount - Transaction amount
   * @param {string} type - Transaction type
   * @param {number} timestamp - Transaction timestamp
   * @param {Object} metadata - Transaction metadata
   * @returns {Promise<Object>} Pattern analysis
   */
  async analyzePatterns(userId, amount, type, timestamp, metadata) {
    let riskScore = 0;
    const flags = [];
    const details = {};

    // Check for rapid succession transactions
    const userHistory = this.getUserTransactionHistory(userId);
    const lastTransaction = userHistory[userHistory.length - 1];
    
    if (lastTransaction && (timestamp - lastTransaction.timestamp) < this.config.suspiciousPatterns.rapidSuccession) {
      riskScore += 15;
      flags.push('rapid_succession');
      details.timeSinceLastTransaction = timestamp - lastTransaction.timestamp;
    }

    // Check for round amounts (potential money laundering)
    if (this.config.suspiciousPatterns.roundAmounts.includes(amount)) {
      riskScore += 10;
      flags.push('round_amount');
    }

    // Check for repeated identical amounts
    const recentSameAmounts = userHistory
      .filter(tx => tx.amount === amount && (timestamp - tx.timestamp) < 24 * 60 * 60 * 1000)
      .length;
    
    if (recentSameAmounts >= 3) {
      riskScore += 20;
      flags.push('repeated_amounts');
      details.repeatedAmountCount = recentSameAmounts;
    }

    // Check metadata patterns
    if (metadata.ip && this.isIPSuspicious(metadata.ip)) {
      riskScore += 25;
      flags.push('suspicious_ip');
    }

    if (metadata.userAgent && this.isUserAgentSuspicious(metadata.userAgent)) {
      riskScore += 15;
      flags.push('suspicious_user_agent');
    }

    return { riskScore, flags, details };
  }

  /**
   * Analyze transaction amount
   * @param {number} userId - User ID
   * @param {number} amount - Transaction amount
   * @param {string} currency - Currency
   * @param {string} type - Transaction type
   * @returns {Promise<Object>} Amount analysis
   */
  async analyzeAmount(userId, amount, currency, type) {
    let riskScore = 0;
    const flags = [];
    const details = { amount, currency };

    // Check for unusually high amounts
    const highAmountThresholds = {
      NGN: 1000000, // 1M NGN
      USD: 10000    // 10k USD
    };

    const threshold = highAmountThresholds[currency] || 10000;
    if (amount > threshold) {
      riskScore += 20;
      flags.push('high_amount');
      details.threshold = threshold;
    }

    // Check for micro-transactions (potential testing)
    if (amount < 100 && type !== 'transfer') {
      riskScore += 5;
      flags.push('micro_transaction');
    }

    // Check for amounts just below reporting thresholds
    const reportingThresholds = {
      NGN: 5000000, // 5M NGN
      USD: 10000    // 10k USD (CTR threshold)
    };

    const reportingThreshold = reportingThresholds[currency];
    if (reportingThreshold && amount > reportingThreshold * 0.9 && amount < reportingThreshold) {
      riskScore += 25;
      flags.push('structuring_attempt');
      details.reportingThreshold = reportingThreshold;
    }

    return { riskScore, flags, details };
  }

  /**
   * Analyze transaction timing
   * @param {number} timestamp - Transaction timestamp
   * @returns {Promise<Object>} Timing analysis
   */
  async analyzeTiming(timestamp) {
    let riskScore = 0;
    const flags = [];
    const details = {};

    const date = new Date(timestamp);
    const hour = date.getHours();
    const dayOfWeek = date.getDay();

    // Check for night hours (higher risk)
    const nightHours = this.config.suspiciousPatterns.timePatterns.nightHours;
    if (hour >= nightHours.start || hour <= nightHours.end) {
      riskScore += 5;
      flags.push('night_hours');
      details.hour = hour;
    }

    // Check for weekend transactions (slightly higher risk)
    if (this.config.suspiciousPatterns.timePatterns.weekends.includes(dayOfWeek)) {
      riskScore += 3;
      flags.push('weekend_transaction');
      details.dayOfWeek = dayOfWeek;
    }

    return { riskScore, flags, details };
  }

  /**
   * Record transaction for analysis
   * @param {Object} transaction - Transaction details
   */
  async recordTransaction(transaction) {
    const { userId, amount, currency, type, timestamp } = transaction;
    
    if (!this.transactionHistory.has(userId)) {
      this.transactionHistory.set(userId, []);
    }

    const userHistory = this.transactionHistory.get(userId);
    userHistory.push({
      amount,
      currency,
      type,
      timestamp,
      riskScore: 0 // Will be updated after analysis
    });

    // Keep only recent transactions (last 7 days)
    const sevenDaysAgo = timestamp - (7 * 24 * 60 * 60 * 1000);
    const recentHistory = userHistory.filter(tx => tx.timestamp > sevenDaysAgo);
    this.transactionHistory.set(userId, recentHistory);
  }

  /**
   * Update user risk score
   * @param {number} userId - User ID
   * @param {number} transactionRiskScore - Risk score from transaction
   */
  async updateRiskScore(userId, transactionRiskScore) {
    const currentScore = this.riskScores.get(userId) || 0;
    
    // Calculate new risk score (weighted average with decay)
    const decayFactor = 0.9; // Previous score decays by 10%
    const newScore = (currentScore * decayFactor) + (transactionRiskScore * 0.1);
    
    this.riskScores.set(userId, Math.min(newScore, 100));
  }

  /**
   * Get user transaction history
   * @param {number} userId - User ID
   * @returns {Array} Transaction history
   */
  getUserTransactionHistory(userId) {
    return this.transactionHistory.get(userId) || [];
  }

  /**
   * Get user behavioral baseline
   * @param {number} userId - User ID
   * @returns {Object|null} User baseline
   */
  getUserBaseline(userId) {
    return this.userBaselines.get(userId) || null;
  }

  /**
   * Log suspicious activity
   * @param {number} userId - User ID
   * @param {Object} activity - Activity details
   */
  async logSuspiciousActivity(userId, activity) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      userId,
      type: 'fraud_detection',
      severity: activity.riskScore >= this.config.riskThresholds.high ? 'high' : 'medium',
      ...activity
    };

    console.warn('[Fraud Detection] Suspicious activity detected:', logEntry);

    // Store for tracking
    if (!this.suspiciousActivity.has(userId)) {
      this.suspiciousActivity.set(userId, []);
    }
    
    const userActivity = this.suspiciousActivity.get(userId);
    userActivity.push(logEntry);

    // Check for auto-block conditions
    if (userActivity.length >= this.config.autoBlockThresholds.suspiciousCount) {
      await this.autoBlockUser(userId, 'Multiple suspicious activities', activity);
    }

    // In production, send to security monitoring system
    // this.securityMonitor.alert(logEntry);
  }

  /**
   * Auto-block user due to suspicious activity
   * @param {number} userId - User ID
   * @param {string} reason - Block reason
   * @param {Object} details - Additional details
   */
  async autoBlockUser(userId, reason, details) {
    this.blockedUsers.add(userId);
    
    const blockEntry = {
      timestamp: new Date().toISOString(),
      userId,
      reason,
      details,
      type: 'auto_block'
    };

    console.error('[Fraud Detection] User auto-blocked:', blockEntry);

    // In production, send immediate alert
    // this.securityMonitor.criticalAlert(blockEntry);
  }

  /**
   * Check if IP is suspicious
   * @param {string} ip - IP address
   * @returns {boolean} True if suspicious
   */
  isIPSuspicious(ip) {
    // Simple checks - in production, use threat intelligence feeds
    const suspiciousPatterns = [
      /^10\./, // Private IP (suspicious for external transactions)
      /^192\.168\./, // Private IP
      /^172\.(1[6-9]|2[0-9]|3[01])\./ // Private IP
    ];

    return suspiciousPatterns.some(pattern => pattern.test(ip));
  }

  /**
   * Check if user agent is suspicious
   * @param {string} userAgent - User agent string
   * @returns {boolean} True if suspicious
   */
  isUserAgentSuspicious(userAgent) {
    const suspiciousPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /curl/i,
      /wget/i,
      /python/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  /**
   * Calculate user behavioral baselines
   */
  calculateBaselines() {
    console.log('[Fraud Detection] Calculating user baselines...');

    for (const [userId, history] of this.transactionHistory.entries()) {
      if (history.length < 10) continue; // Need at least 10 transactions

      const baseline = {
        avgAmount: history.reduce((sum, tx) => sum + tx.amount, 0) / history.length,
        avgTransactionsPerHour: this.calculateAvgTransactionsPerHour(history),
        typeFrequency: this.calculateTypeFrequency(history),
        activeHours: this.calculateActiveHours(history),
        lastUpdated: Date.now()
      };

      this.userBaselines.set(userId, baseline);
    }

    console.log(`[Fraud Detection] Updated baselines for ${this.userBaselines.size} users`);
  }

  /**
   * Calculate average transactions per hour
   * @param {Array} history - Transaction history
   * @returns {number} Average transactions per hour
   */
  calculateAvgTransactionsPerHour(history) {
    if (history.length === 0) return 0;

    const timeSpan = Math.max(history[history.length - 1].timestamp - history[0].timestamp, 60 * 60 * 1000);
    const hours = timeSpan / (60 * 60 * 1000);
    
    return history.length / hours;
  }

  /**
   * Calculate transaction type frequency
   * @param {Array} history - Transaction history
   * @returns {Object} Type frequency map
   */
  calculateTypeFrequency(history) {
    const typeCounts = {};
    
    history.forEach(tx => {
      typeCounts[tx.type] = (typeCounts[tx.type] || 0) + 1;
    });

    const total = history.length;
    const frequency = {};
    
    for (const [type, count] of Object.entries(typeCounts)) {
      frequency[type] = count / total;
    }

    return frequency;
  }

  /**
   * Calculate user's active hours
   * @param {Array} history - Transaction history
   * @returns {Array} Array of active hours (0-23)
   */
  calculateActiveHours(history) {
    const hourCounts = {};
    
    history.forEach(tx => {
      const hour = new Date(tx.timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    // Return hours with significant activity (>5% of transactions)
    const threshold = history.length * 0.05;
    return Object.entries(hourCounts)
      .filter(([hour, count]) => count >= threshold)
      .map(([hour]) => parseInt(hour));
  }

  /**
   * Start baseline calculation interval
   */
  startBaselineCalculation() {
    // Calculate baselines every hour
    setInterval(() => {
      this.calculateBaselines();
    }, 60 * 60 * 1000);

    // Initial calculation after 5 minutes
    setTimeout(() => {
      this.calculateBaselines();
    }, 5 * 60 * 1000);
  }

  /**
   * Get fraud detection statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    return {
      totalUsers: this.transactionHistory.size,
      usersWithBaselines: this.userBaselines.size,
      blockedUsers: this.blockedUsers.size,
      suspiciousActivities: Array.from(this.suspiciousActivity.values()).flat().length,
      avgRiskScore: this.calculateAverageRiskScore(),
      config: this.config
    };
  }

  /**
   * Calculate average risk score across all users
   * @returns {number} Average risk score
   */
  calculateAverageRiskScore() {
    if (this.riskScores.size === 0) return 0;
    
    const total = Array.from(this.riskScores.values()).reduce((sum, score) => sum + score, 0);
    return total / this.riskScores.size;
  }

  /**
   * Admin function: Unblock user
   * @param {number} userId - User ID to unblock
   */
  unblockUser(userId) {
    this.blockedUsers.delete(userId);
    this.riskScores.set(userId, 0);
    console.log(`[Fraud Detection] User ${userId} unblocked by admin`);
  }

  /**
   * Admin function: Get user risk profile
   * @param {number} userId - User ID
   * @returns {Object} User risk profile
   */
  getUserRiskProfile(userId) {
    return {
      riskScore: this.riskScores.get(userId) || 0,
      isBlocked: this.blockedUsers.has(userId),
      baseline: this.getUserBaseline(userId),
      recentTransactions: this.getUserTransactionHistory(userId).slice(-10),
      suspiciousActivities: this.suspiciousActivity.get(userId) || []
    };
  }
}

module.exports = FraudDetectionService;