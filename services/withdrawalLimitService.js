const { idempotencyService } = require('./idempotencyService');

/**
 * Withdrawal Limit Service
 * 
 * Provides comprehensive withdrawal limit management with:
 * - Daily and monthly withdrawal limits per currency
 * - Limit tracking and enforcement
 * - Configurable limits per user
 * - Limit reset and rollover functionality
 * - Admin override capabilities
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

class WithdrawalLimitService {
  constructor() {
    this.idempotencyService = idempotencyService;
    
    // Default withdrawal limits configuration
    this.config = {
      // Default limits per currency (in base units)
      defaultLimits: {
        NGN: {
          daily: 2000000,    // 2M NGN per day
          monthly: 50000000, // 50M NGN per month
          single: 1000000    // 1M NGN per transaction
        },
        USD: {
          daily: 5000,       // $5,000 per day
          monthly: 100000,   // $100,000 per month
          single: 2500       // $2,500 per transaction
        }
      },
      
      // VIP user limits (higher limits for verified users)
      vipLimits: {
        NGN: {
          daily: 10000000,   // 10M NGN per day
          monthly: 200000000, // 200M NGN per month
          single: 5000000    // 5M NGN per transaction
        },
        USD: {
          daily: 25000,      // $25,000 per day
          monthly: 500000,   // $500,000 per month
          single: 10000      // $10,000 per transaction
        }
      },
      
      // Business user limits (highest limits for business accounts)
      businessLimits: {
        NGN: {
          daily: 50000000,   // 50M NGN per day
          monthly: 1000000000, // 1B NGN per month
          single: 25000000   // 25M NGN per transaction
        },
        USD: {
          daily: 100000,     // $100,000 per day
          monthly: 2000000,  // $2M per month
          single: 50000      // $50,000 per transaction
        }
      },
      
      // Timezone for limit calculations (UTC)
      timezone: 'UTC',
      
      // Grace period for limit resets (in milliseconds)
      gracePeriod: 5 * 60 * 1000 // 5 minutes
    };

    // In-memory stores (in production, use Redis or database)
    this.userLimits = new Map();        // Custom user limits
    this.dailyUsage = new Map();        // Daily withdrawal usage
    this.monthlyUsage = new Map();      // Monthly withdrawal usage
    this.userTiers = new Map();         // User tier assignments
    this.limitOverrides = new Map();    // Admin limit overrides
    this.suspendedUsers = new Set();    // Users with suspended withdrawal privileges
    
    // Start cleanup interval for expired data
    this.startCleanupInterval();
  }

  /**
   * Check if withdrawal is within limits
   * @param {number} userId - User ID
   * @param {number} amount - Withdrawal amount
   * @param {string} currency - Currency code
   * @returns {Promise<Object>} Limit check result
   */
  async checkWithdrawalLimits(userId, amount, currency) {
    try {
      console.log(`[Withdrawal Limits] Checking limits for user ${userId}: ${amount} ${currency}`);

      // Check if user is suspended
      if (this.suspendedUsers.has(userId)) {
        return {
          allowed: false,
          reason: 'Withdrawal privileges suspended',
          type: 'suspended',
          limits: null,
          usage: null
        };
      }

      // Get user limits
      const limits = await this.getUserLimits(userId, currency);
      
      // Get current usage
      const usage = await this.getCurrentUsage(userId, currency);
      
      // Check single transaction limit
      if (amount > limits.single) {
        return {
          allowed: false,
          reason: `Amount exceeds single transaction limit of ${limits.single} ${currency}`,
          type: 'single_limit',
          limits,
          usage,
          exceeded: {
            type: 'single',
            limit: limits.single,
            requested: amount
          }
        };
      }

      // Check daily limit
      const newDailyTotal = usage.daily + amount;
      if (newDailyTotal > limits.daily) {
        return {
          allowed: false,
          reason: `Amount would exceed daily limit of ${limits.daily} ${currency}`,
          type: 'daily_limit',
          limits,
          usage,
          exceeded: {
            type: 'daily',
            limit: limits.daily,
            current: usage.daily,
            requested: amount,
            wouldBe: newDailyTotal
          }
        };
      }

      // Check monthly limit
      const newMonthlyTotal = usage.monthly + amount;
      if (newMonthlyTotal > limits.monthly) {
        return {
          allowed: false,
          reason: `Amount would exceed monthly limit of ${limits.monthly} ${currency}`,
          type: 'monthly_limit',
          limits,
          usage,
          exceeded: {
            type: 'monthly',
            limit: limits.monthly,
            current: usage.monthly,
            requested: amount,
            wouldBe: newMonthlyTotal
          }
        };
      }

      // All checks passed
      console.log(`[Withdrawal Limits] Withdrawal approved for user ${userId}: ${amount} ${currency}`);
      
      return {
        allowed: true,
        reason: 'Withdrawal within limits',
        type: 'approved',
        limits,
        usage,
        remaining: {
          daily: limits.daily - usage.daily,
          monthly: limits.monthly - usage.monthly
        }
      };
    } catch (error) {
      console.error('[Withdrawal Limits] Check error:', error);
      // On error, deny withdrawal for safety
      return {
        allowed: false,
        reason: 'Limit check error - withdrawal denied for safety',
        type: 'error',
        error: error.message
      };
    }
  }

  /**
   * Record withdrawal usage
   * @param {number} userId - User ID
   * @param {number} amount - Withdrawal amount
   * @param {string} currency - Currency code
   * @param {string} reference - Transaction reference
   * @returns {Promise<void>}
   */
  async recordWithdrawal(userId, amount, currency, reference) {
    try {
      const now = new Date();
      const dailyKey = this.getDailyKey(userId, currency, now);
      const monthlyKey = this.getMonthlyKey(userId, currency, now);

      console.log(`[Withdrawal Limits] Recording withdrawal for user ${userId}: ${amount} ${currency}`);

      // Update daily usage
      if (!this.dailyUsage.has(dailyKey)) {
        this.dailyUsage.set(dailyKey, {
          userId,
          currency,
          date: now.toISOString().split('T')[0],
          amount: 0,
          count: 0,
          transactions: []
        });
      }

      const dailyData = this.dailyUsage.get(dailyKey);
      dailyData.amount += amount;
      dailyData.count += 1;
      dailyData.transactions.push({
        amount,
        reference,
        timestamp: now.toISOString()
      });

      // Update monthly usage
      if (!this.monthlyUsage.has(monthlyKey)) {
        this.monthlyUsage.set(monthlyKey, {
          userId,
          currency,
          month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
          amount: 0,
          count: 0,
          transactions: []
        });
      }

      const monthlyData = this.monthlyUsage.get(monthlyKey);
      monthlyData.amount += amount;
      monthlyData.count += 1;
      monthlyData.transactions.push({
        amount,
        reference,
        timestamp: now.toISOString()
      });

      console.log(`[Withdrawal Limits] Updated usage - Daily: ${dailyData.amount}, Monthly: ${monthlyData.amount}`);
    } catch (error) {
      console.error('[Withdrawal Limits] Record withdrawal error:', error);
      throw error;
    }
  }

  /**
   * Get user withdrawal limits
   * @param {number} userId - User ID
   * @param {string} currency - Currency code
   * @returns {Promise<Object>} User limits
   */
  async getUserLimits(userId, currency) {
    // Check for admin overrides first
    const overrideKey = `${userId}:${currency}`;
    if (this.limitOverrides.has(overrideKey)) {
      return this.limitOverrides.get(overrideKey);
    }

    // Check for custom user limits
    if (this.userLimits.has(userId)) {
      const customLimits = this.userLimits.get(userId);
      if (customLimits[currency]) {
        return customLimits[currency];
      }
    }

    // Get limits based on user tier
    const userTier = this.getUserTier(userId);
    const tierLimits = this.config[`${userTier}Limits`] || this.config.defaultLimits;
    
    return tierLimits[currency] || this.config.defaultLimits[currency];
  }

  /**
   * Get current withdrawal usage
   * @param {number} userId - User ID
   * @param {string} currency - Currency code
   * @returns {Promise<Object>} Current usage
   */
  async getCurrentUsage(userId, currency) {
    const now = new Date();
    const dailyKey = this.getDailyKey(userId, currency, now);
    const monthlyKey = this.getMonthlyKey(userId, currency, now);

    const dailyData = this.dailyUsage.get(dailyKey);
    const monthlyData = this.monthlyUsage.get(monthlyKey);

    return {
      daily: dailyData ? dailyData.amount : 0,
      monthly: monthlyData ? monthlyData.amount : 0,
      dailyCount: dailyData ? dailyData.count : 0,
      monthlyCount: monthlyData ? monthlyData.count : 0
    };
  }

  /**
   * Get user tier (default, vip, business)
   * @param {number} userId - User ID
   * @returns {string} User tier
   */
  getUserTier(userId) {
    return this.userTiers.get(userId) || 'default';
  }

  /**
   * Set user tier
   * @param {number} userId - User ID
   * @param {string} tier - User tier (default, vip, business)
   */
  setUserTier(userId, tier) {
    const validTiers = ['default', 'vip', 'business'];
    if (!validTiers.includes(tier)) {
      throw new Error(`Invalid tier: ${tier}. Must be one of: ${validTiers.join(', ')}`);
    }
    
    this.userTiers.set(userId, tier);
    console.log(`[Withdrawal Limits] User ${userId} tier set to: ${tier}`);
  }

  /**
   * Set custom limits for user
   * @param {number} userId - User ID
   * @param {string} currency - Currency code
   * @param {Object} limits - Custom limits
   */
  setCustomLimits(userId, currency, limits) {
    if (!this.userLimits.has(userId)) {
      this.userLimits.set(userId, {});
    }
    
    const userLimits = this.userLimits.get(userId);
    userLimits[currency] = {
      daily: limits.daily || 0,
      monthly: limits.monthly || 0,
      single: limits.single || 0
    };
    
    console.log(`[Withdrawal Limits] Custom limits set for user ${userId} (${currency}):`, userLimits[currency]);
  }

  /**
   * Admin override limits for user
   * @param {number} userId - User ID
   * @param {string} currency - Currency code
   * @param {Object} limits - Override limits
   * @param {string} reason - Override reason
   */
  adminOverrideLimits(userId, currency, limits, reason) {
    const overrideKey = `${userId}:${currency}`;
    
    this.limitOverrides.set(overrideKey, {
      daily: limits.daily || 0,
      monthly: limits.monthly || 0,
      single: limits.single || 0,
      reason,
      timestamp: new Date().toISOString(),
      type: 'admin_override'
    });
    
    console.log(`[Withdrawal Limits] Admin override set for user ${userId} (${currency}): ${reason}`);
  }

  /**
   * Suspend user withdrawal privileges
   * @param {number} userId - User ID
   * @param {string} reason - Suspension reason
   */
  suspendUser(userId, reason) {
    this.suspendedUsers.add(userId);
    console.log(`[Withdrawal Limits] User ${userId} suspended: ${reason}`);
  }

  /**
   * Restore user withdrawal privileges
   * @param {number} userId - User ID
   */
  restoreUser(userId) {
    this.suspendedUsers.delete(userId);
    console.log(`[Withdrawal Limits] User ${userId} withdrawal privileges restored`);
  }

  /**
   * Get daily key for usage tracking
   * @param {number} userId - User ID
   * @param {string} currency - Currency code
   * @param {Date} date - Date
   * @returns {string} Daily key
   */
  getDailyKey(userId, currency, date) {
    const dateStr = date.toISOString().split('T')[0];
    return `daily:${userId}:${currency}:${dateStr}`;
  }

  /**
   * Get monthly key for usage tracking
   * @param {number} userId - User ID
   * @param {string} currency - Currency code
   * @param {Date} date - Date
   * @returns {string} Monthly key
   */
  getMonthlyKey(userId, currency, date) {
    const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `monthly:${userId}:${currency}:${monthStr}`;
  }

  /**
   * Get withdrawal statistics for user
   * @param {number} userId - User ID
   * @param {string} currency - Currency code (optional)
   * @returns {Object} Withdrawal statistics
   */
  getUserWithdrawalStats(userId, currency = null) {
    const stats = {
      userId,
      tier: this.getUserTier(userId),
      suspended: this.suspendedUsers.has(userId),
      currencies: {}
    };

    const currencies = currency ? [currency] : ['NGN', 'USD'];
    
    for (const curr of currencies) {
      const limits = this.getUserLimits(userId, curr);
      const usage = this.getCurrentUsage(userId, curr);
      
      stats.currencies[curr] = {
        limits,
        usage,
        remaining: {
          daily: limits.daily - usage.daily,
          monthly: limits.monthly - usage.monthly
        },
        utilizationPercent: {
          daily: limits.daily > 0 ? (usage.daily / limits.daily) * 100 : 0,
          monthly: limits.monthly > 0 ? (usage.monthly / limits.monthly) * 100 : 0
        }
      };
    }

    return stats;
  }

  /**
   * Get system-wide withdrawal statistics
   * @returns {Object} System statistics
   */
  getSystemStats() {
    return {
      totalUsers: new Set([...this.dailyUsage.keys(), ...this.monthlyUsage.keys()]
        .map(key => key.split(':')[1])).size,
      suspendedUsers: this.suspendedUsers.size,
      customLimits: this.userLimits.size,
      adminOverrides: this.limitOverrides.size,
      dailyUsageRecords: this.dailyUsage.size,
      monthlyUsageRecords: this.monthlyUsage.size,
      config: this.config
    };
  }

  /**
   * Start cleanup interval for expired data
   */
  startCleanupInterval() {
    // Clean up old data every hour
    setInterval(() => {
      this.cleanupExpiredData();
    }, 60 * 60 * 1000);

    // Initial cleanup after 5 minutes
    setTimeout(() => {
      this.cleanupExpiredData();
    }, 5 * 60 * 1000);
  }

  /**
   * Clean up expired usage data
   */
  cleanupExpiredData() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const twoMonthsAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000));

    let cleanedDaily = 0;
    let cleanedMonthly = 0;

    // Clean up daily usage older than 30 days
    for (const [key, data] of this.dailyUsage.entries()) {
      const dataDate = new Date(data.date);
      if (dataDate < thirtyDaysAgo) {
        this.dailyUsage.delete(key);
        cleanedDaily++;
      }
    }

    // Clean up monthly usage older than 2 months
    for (const [key, data] of this.monthlyUsage.entries()) {
      const [year, month] = data.month.split('-').map(Number);
      const dataDate = new Date(year, month - 1, 1);
      if (dataDate < twoMonthsAgo) {
        this.monthlyUsage.delete(key);
        cleanedMonthly++;
      }
    }

    if (cleanedDaily > 0 || cleanedMonthly > 0) {
      console.log(`[Withdrawal Limits] Cleanup completed - Daily: ${cleanedDaily}, Monthly: ${cleanedMonthly}`);
    }
  }

  /**
   * Reset user limits to default
   * @param {number} userId - User ID
   */
  resetUserToDefault(userId) {
    this.userLimits.delete(userId);
    this.userTiers.delete(userId);
    
    // Remove overrides
    for (const key of this.limitOverrides.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.limitOverrides.delete(key);
      }
    }
    
    console.log(`[Withdrawal Limits] User ${userId} reset to default limits`);
  }
}

module.exports = WithdrawalLimitService;