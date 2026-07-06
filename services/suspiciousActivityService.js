const { createRedisClient } = require('../config/redis');
const User = require('../models/User');

/**
 * Suspicious Activity Detection Service
 * 
 * Detects and flags suspicious behavior:
 * - Invalid timestamps
 * - Excessive rate limit violations
 * - Auto-flag accounts with multiple violations
 * - Notify admins of flagged accounts
 */

class SuspiciousActivityService {
  constructor() {
    this.redis = null;
    this.initialized = false;
    this.VIOLATION_THRESHOLD = 5; // Flag after 5 violations
    this.VIOLATION_WINDOW = 3600; // 1 hour window
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    try {
      // Initialize Redis connection using centralized config
      this.redis = createRedisClient();

      this.redis.on('ready', () => {
        console.log('✅ Suspicious Activity Service: Redis ready');
        this.initialized = true;
      });

      console.log('✅ Suspicious Activity Service initialized');
    } catch (error) {
      console.error('❌ Suspicious Activity Service initialization failed:', error.message);
    }
  }

  /**
   * Flag invalid timestamp
   * 
   * @param {number} userId - User ID
   * @param {Object} details - Violation details
   */
  async flagInvalidTimestamp(userId, details) {
    const violation = {
      type: 'invalid_timestamp',
      userId,
      timestamp: Date.now(),
      details: {
        clientTimestamp: details.clientTimestamp,
        serverTimestamp: details.serverTimestamp,
        latency: details.latency,
        matchId: details.matchId,
        questionId: details.questionId
      }
    };

    await this.recordViolation(userId, violation);
    
    console.warn(`[SuspiciousActivity] Invalid timestamp detected for user ${userId}:`, violation.details);
  }

  /**
   * Flag rate limit violation
   * 
   * @param {number} userId - User ID
   * @param {Object} details - Violation details
   */
  async flagRateLimitViolation(userId, details) {
    const violation = {
      type: 'rate_limit_violation',
      userId,
      timestamp: Date.now(),
      details: {
        endpoint: details.endpoint,
        limit: details.limit,
        attempts: details.attempts,
        ip: details.ip
      }
    };

    await this.recordViolation(userId, violation);
    
    console.warn(`[SuspiciousActivity] Rate limit violation for user ${userId}:`, violation.details);
  }

  /**
   * Flag impossible answer speed
   * 
   * @param {number} userId - User ID
   * @param {Object} details - Violation details
   */
  async flagImpossibleSpeed(userId, details) {
    const violation = {
      type: 'impossible_speed',
      userId,
      timestamp: Date.now(),
      details: {
        responseTime: details.responseTime,
        matchId: details.matchId,
        questionId: details.questionId
      }
    };

    await this.recordViolation(userId, violation);
    
    console.warn(`[SuspiciousActivity] Impossible answer speed for user ${userId}:`, violation.details);
  }

  /**
   * Flag suspicious pattern
   * 
   * @param {number} userId - User ID
   * @param {Object} details - Violation details
   */
  async flagSuspiciousPattern(userId, details) {
    const violation = {
      type: 'suspicious_pattern',
      userId,
      timestamp: Date.now(),
      details
    };

    await this.recordViolation(userId, violation);
    
    console.warn(`[SuspiciousActivity] Suspicious pattern detected for user ${userId}:`, violation.details);
  }

  /**
   * Record violation and check threshold
   * 
   * @param {number} userId - User ID
   * @param {Object} violation - Violation data
   */
  async recordViolation(userId, violation) {
    if (!this.initialized || !this.redis) {
      console.warn('[SuspiciousActivity] Redis not initialized, violation not recorded');
      return;
    }

    try {
      const key = `quiz:violations:${userId}`;
      const now = Date.now();
      const windowStart = now - (this.VIOLATION_WINDOW * 1000);

      // Add violation to sorted set
      await this.redis.zadd(key, now, JSON.stringify(violation));

      // Remove old violations outside window
      await this.redis.zremrangebyscore(key, 0, windowStart);

      // Set expiry
      await this.redis.expire(key, this.VIOLATION_WINDOW);

      // Count violations in window
      const violationCount = await this.redis.zcard(key);

      // Check if threshold exceeded
      if (violationCount >= this.VIOLATION_THRESHOLD) {
        await this.autoFlagAccount(userId, violationCount);
      }

    } catch (error) {
      console.error('[SuspiciousActivity] Error recording violation:', error);
    }
  }

  /**
   * Auto-flag account with multiple violations
   * 
   * @param {number} userId - User ID
   * @param {number} violationCount - Number of violations
   */
  async autoFlagAccount(userId, violationCount) {
    try {
      const flagKey = `quiz:flagged:${userId}`;
      
      // Check if already flagged
      const alreadyFlagged = await this.redis.exists(flagKey);
      
      if (alreadyFlagged) {
        return; // Already flagged
      }

      // Flag account
      await this.redis.setex(flagKey, 86400, JSON.stringify({
        userId,
        flaggedAt: Date.now(),
        violationCount,
        reason: 'Multiple suspicious activities detected'
      }));

      console.error(`[SuspiciousActivity] 🚨 Account auto-flagged: User ${userId} (${violationCount} violations)`);

      // Notify admins
      await this.notifyAdmins(userId, violationCount);

    } catch (error) {
      console.error('[SuspiciousActivity] Error auto-flagging account:', error);
    }
  }

  /**
   * Notify admins of flagged account
   * 
   * @param {number} userId - User ID
   * @param {number} violationCount - Number of violations
   */
  async notifyAdmins(userId, violationCount) {
    try {
      // Get user details
      const user = await User.findByPk(userId);
      
      if (!user) {
        return;
      }

      // Get recent violations
      const violations = await this.getViolations(userId);

      // In production, this would send email/notification to admins
      console.log(`[SuspiciousActivity] 📧 Admin notification:`, {
        userId,
        userEmail: user.email,
        userName: `${user.firstname} ${user.lastname}`,
        violationCount,
        recentViolations: violations.slice(0, 5)
      });

      // TODO: Integrate with notification service
      // await notificationService.notifyAdmins({
      //   type: 'suspicious_activity',
      //   userId,
      //   violationCount,
      //   violations
      // });

    } catch (error) {
      console.error('[SuspiciousActivity] Error notifying admins:', error);
    }
  }

  /**
   * Get violations for a user
   * 
   * @param {number} userId - User ID
   * @returns {Promise<Array>} Array of violations
   */
  async getViolations(userId) {
    if (!this.initialized || !this.redis) {
      return [];
    }

    try {
      const key = `quiz:violations:${userId}`;
      const violations = await this.redis.zrange(key, 0, -1);

      return violations.map(v => JSON.parse(v));
    } catch (error) {
      console.error('[SuspiciousActivity] Error getting violations:', error);
      return [];
    }
  }

  /**
   * Check if account is flagged
   * 
   * @param {number} userId - User ID
   * @returns {Promise<boolean>} True if flagged
   */
  async isAccountFlagged(userId) {
    if (!this.initialized || !this.redis) {
      return false;
    }

    try {
      const flagKey = `quiz:flagged:${userId}`;
      const exists = await this.redis.exists(flagKey);
      return exists === 1;
    } catch (error) {
      console.error('[SuspiciousActivity] Error checking flag status:', error);
      return false;
    }
  }

  /**
   * Get flagged account details
   * 
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} Flag details or null
   */
  async getFlagDetails(userId) {
    if (!this.initialized || !this.redis) {
      return null;
    }

    try {
      const flagKey = `quiz:flagged:${userId}`;
      const data = await this.redis.get(flagKey);
      
      if (!data) {
        return null;
      }

      return JSON.parse(data);
    } catch (error) {
      console.error('[SuspiciousActivity] Error getting flag details:', error);
      return null;
    }
  }

  /**
   * Unflag account (admin action)
   * 
   * @param {number} userId - User ID
   * @param {number} adminId - Admin user ID
   */
  async unflagAccount(userId, adminId) {
    if (!this.initialized || !this.redis) {
      return;
    }

    try {
      const flagKey = `quiz:flagged:${userId}`;
      await this.redis.del(flagKey);

      console.log(`[SuspiciousActivity] Account unflagged: User ${userId} by Admin ${adminId}`);
    } catch (error) {
      console.error('[SuspiciousActivity] Error unflagging account:', error);
    }
  }

  /**
   * Clear violations for a user (admin action)
   * 
   * @param {number} userId - User ID
   * @param {number} adminId - Admin user ID
   */
  async clearViolations(userId, adminId) {
    if (!this.initialized || !this.redis) {
      return;
    }

    try {
      const key = `quiz:violations:${userId}`;
      await this.redis.del(key);

      console.log(`[SuspiciousActivity] Violations cleared: User ${userId} by Admin ${adminId}`);
    } catch (error) {
      console.error('[SuspiciousActivity] Error clearing violations:', error);
    }
  }

  /**
   * Get statistics
   * 
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    if (!this.initialized || !this.redis) {
      return {
        totalFlagged: 0,
        totalViolations: 0
      };
    }

    try {
      const flaggedKeys = await this.redis.keys('quiz:flagged:*');
      const violationKeys = await this.redis.keys('quiz:violations:*');

      return {
        totalFlagged: flaggedKeys.length,
        totalViolations: violationKeys.length
      };
    } catch (error) {
      console.error('[SuspiciousActivity] Error getting stats:', error);
      return {
        totalFlagged: 0,
        totalViolations: 0
      };
    }
  }
}

module.exports = new SuspiciousActivityService();
