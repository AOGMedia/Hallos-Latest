const { createRedisClient } = require('../config/redis');

/**
 * Active User Tracker Service
 * 
 * Tracks active users on the quiz platform using Redis
 * Features:
 * - 3-minute activity timeout
 * - Real-time active count
 * - Automatic cleanup of inactive users
 * - WebSocket broadcasting of count updates
 */

class ActiveUserTracker {
  constructor() {
    this.redis = null;
    this.websocketManager = null;
    this.cleanupInterval = null;
    this.ACTIVE_USER_PREFIX = 'quiz:active_user:';
    this.ACTIVE_USER_TTL = 180; // 3 minutes in seconds
  }

  /**
   * Initialize Redis connection and start cleanup
   * 
   * @param {Object} websocketManager - WebSocket manager instance for broadcasting
   */
  async initialize(websocketManager) {
    try {
      // Initialize Redis connection using centralized config
      this.redis = createRedisClient();

      this.websocketManager = websocketManager;

      // Start cleanup interval (every 30 seconds)
      this.startCleanup();

      console.log('✅ Active User Tracker initialized');
    } catch (error) {
      console.error('❌ Active User Tracker initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Mark user as active
   * Sets/refreshes user's activity timestamp with 3-minute TTL
   * 
   * @param {number} userId - User ID
   */
  async markUserActive(userId) {
    try {
      const key = `${this.ACTIVE_USER_PREFIX}${userId}`;
      const timestamp = Date.now();

      // Set key with TTL
      await this.redis.setex(key, this.ACTIVE_USER_TTL, timestamp);

      // Broadcast updated count
      await this.broadcastActiveCount();
    } catch (error) {
      console.error(`[ActiveUserTracker] Error marking user ${userId} active:`, error.message);
    }
  }

  /**
   * Remove user from active tracking
   * 
   * @param {number} userId - User ID
   */
  async markUserInactive(userId) {
    try {
      const key = `${this.ACTIVE_USER_PREFIX}${userId}`;
      await this.redis.del(key);

      // Broadcast updated count
      await this.broadcastActiveCount();
    } catch (error) {
      console.error(`[ActiveUserTracker] Error marking user ${userId} inactive:`, error.message);
    }
  }

  /**
   * Get current active user count
   * 
   * @returns {Promise<number>} Number of active users
   */
  async getActiveUserCount() {
    try {
      const keys = await this.redis.keys(`${this.ACTIVE_USER_PREFIX}*`);
      return keys.length;
    } catch (error) {
      console.error('[ActiveUserTracker] Error getting active user count:', error.message);
      return 0;
    }
  }

  /**
   * Check if user is currently active
   * 
   * @param {number} userId - User ID
   * @returns {Promise<boolean>} True if user is active
   */
  async isUserActive(userId) {
    try {
      const key = `${this.ACTIVE_USER_PREFIX}${userId}`;
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      console.error(`[ActiveUserTracker] Error checking if user ${userId} is active:`, error.message);
      return false;
    }
  }

  /**
   * Get user's last activity timestamp
   * 
   * @param {number} userId - User ID
   * @returns {Promise<number|null>} Timestamp or null if not active
   */
  async getUserLastActivity(userId) {
    try {
      const key = `${this.ACTIVE_USER_PREFIX}${userId}`;
      const timestamp = await this.redis.get(key);
      return timestamp ? parseInt(timestamp, 10) : null;
    } catch (error) {
      console.error(`[ActiveUserTracker] Error getting last activity for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Get all active user IDs
   * 
   * @returns {Promise<number[]>} Array of active user IDs
   */
  async getActiveUserIds() {
    try {
      const keys = await this.redis.keys(`${this.ACTIVE_USER_PREFIX}*`);
      return keys.map(key => {
        const userId = key.replace(this.ACTIVE_USER_PREFIX, '');
        return parseInt(userId, 10);
      });
    } catch (error) {
      console.error('[ActiveUserTracker] Error getting active user IDs:', error.message);
      return [];
    }
  }

  /**
   * Broadcast active user count to all connected clients
   */
  async broadcastActiveCount() {
    try {
      if (!this.websocketManager || !this.websocketManager.io) {
        return;
      }

      const count = await this.getActiveUserCount();

      this.websocketManager.io.emit('active_users_update', {
        count,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[ActiveUserTracker] Error broadcasting active count:', error.message);
    }
  }

  /**
   * Start cleanup interval
   * Runs every 30 seconds to clean up expired entries and broadcast count
   */
  startCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        // Redis automatically expires keys with TTL, but we broadcast count
        await this.broadcastActiveCount();
      } catch (error) {
        console.error('[ActiveUserTracker] Cleanup error:', error.message);
      }
    }, 30000); // 30 seconds

    console.log('✅ Active User Tracker: Cleanup interval started (30s)');
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('🛑 Active User Tracker: Cleanup interval stopped');
    }
  }

  /**
   * Shutdown tracker and close Redis connection
   */
  async shutdown() {
    try {
      this.stopCleanup();

      if (this.redis) {
        await this.redis.quit();
        console.log('✅ Active User Tracker: Redis connection closed');
      }
    } catch (error) {
      console.error('[ActiveUserTracker] Shutdown error:', error.message);
    }
  }

  /**
   * Get tracker statistics
   * 
   * @returns {Promise<Object>} Tracker stats
   */
  async getStats() {
    try {
      const activeCount = await this.getActiveUserCount();
      const activeUserIds = await this.getActiveUserIds();

      return {
        activeCount,
        activeUserIds,
        ttl: this.ACTIVE_USER_TTL,
        cleanupInterval: 30,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[ActiveUserTracker] Error getting stats:', error.message);
      return {
        activeCount: 0,
        activeUserIds: [],
        ttl: this.ACTIVE_USER_TTL,
        cleanupInterval: 30,
        timestamp: Date.now(),
        error: error.message
      };
    }
  }
}

module.exports = new ActiveUserTracker();
