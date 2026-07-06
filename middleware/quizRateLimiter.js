const { createRedisClient } = require('../config/redis');

/**
 * Quiz Rate Limiter Middleware
 * 
 * Redis-based rate limiting for quiz platform:
 * - Answer submissions: 60 per 10 seconds
 * - Challenge creation: 100 per hour
 * - All API endpoints: General rate limiting
 */

class QuizRateLimiter {
  constructor() {
    this.redis = null;
    this.initialized = false;
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    try {
      // Initialize Redis connection using centralized config
      this.redis = createRedisClient();

      this.redis.on('ready', () => {
        console.log('✅ Quiz Rate Limiter: Redis ready');
        this.initialized = true;
      });

      console.log('✅ Quiz Rate Limiter initialized');
    } catch (error) {
      console.error('❌ Quiz Rate Limiter initialization failed:', error.message);
      // Continue without rate limiting
    }
  }

  /**
   * Generic rate limiter
   * 
   * @param {string} key - Redis key
   * @param {number} limit - Maximum requests
   * @param {number} windowSeconds - Time window in seconds
   * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
   */
  async checkLimit(key, limit, windowSeconds) {
    if (!this.initialized || !this.redis) {
      // Redis unavailable - rate limiting is disabled, log a warning
      console.warn('[QuizRateLimiter] Redis unavailable - rate limiting is DISABLED for key:', key);
      return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
    }

    try {
      const now = Date.now();
      const windowStart = now - (windowSeconds * 1000);

      // Use sorted set to track requests with timestamps
      const multi = this.redis.multi();
      
      // Remove old entries outside the window
      multi.zremrangebyscore(key, 0, windowStart);
      
      // Count current requests in window
      multi.zcard(key);
      
      // Add current request
      multi.zadd(key, now, `${now}-${Math.random()}`);
      
      // Set expiry on key
      multi.expire(key, windowSeconds);

      const results = await multi.exec();
      
      // results[1] contains the count before adding current request
      const currentCount = results[1][1];

      if (currentCount >= limit) {
        // Get oldest entry to calculate reset time
        const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
        const resetAt = oldest.length > 0 ? parseInt(oldest[1]) + (windowSeconds * 1000) : now + (windowSeconds * 1000);

        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter: Math.ceil((resetAt - now) / 1000)
        };
      }

      return {
        allowed: true,
        remaining: limit - currentCount - 1,
        resetAt: now + (windowSeconds * 1000)
      };

    } catch (error) {
      console.error('[QuizRateLimiter] Check limit error - rate limiting bypassed for key:', key, error.message);
      // On error, allow request
      return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
    }
  }

  /**
   * Rate limit answer submissions
   * 15 per 10 seconds per user
   */
  answerSubmission() {
    return async (req, res, next) => {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const key = `quiz:ratelimit:answer:${userId}`;
      const result = await this.checkLimit(key, 30, 10);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', '30');
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', result.resetAt.toString());

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter.toString());
        
        return res.status(429).json({
          success: false,
          message: 'Too many answer submissions. Please slow down.',
          retryAfter: result.retryAfter
        });
      }

      next();
    };
  }

  /**
   * Rate limit challenge creation
   * 10 per hour per user
   */
  challengeCreation() {
    return async (req, res, next) => {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const key = `quiz:ratelimit:challenge:${userId}`;
      const result = await this.checkLimit(key, 20, 3600); // 1 hour

      res.setHeader('X-RateLimit-Limit', '20');
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', result.resetAt.toString());

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter.toString());
        
        return res.status(429).json({
          success: false,
          message: 'Too many challenges created. Please wait before creating more.',
          retryAfter: result.retryAfter
        });
      }

      next();
    };
  }

  /**
   * General API rate limiting
   * 100 requests per minute per user
   */
  apiEndpoint() {
    return async (req, res, next) => {
      const userId = req.user?.id;

      if (!userId) {
        // For unauthenticated requests, use IP address (robust detection)
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection.remoteAddress;
        console.log(`[QuizLimit] API IP Access: ${ip}`);
        const key = `quiz:ratelimit:api:ip:${ip}`;
        const result = await this.checkLimit(key, 100, 60); // 100 per minute for IP

        res.setHeader('X-RateLimit-Limit', '100');
        res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
        res.setHeader('X-RateLimit-Reset', result.resetAt.toString());

        if (!result.allowed) {
          res.setHeader('Retry-After', result.retryAfter.toString());
          
          return res.status(429).json({
            success: false,
            message: 'Too many requests. Please slow down.',
            retryAfter: result.retryAfter
          });
        }

        return next();
      }

      const key = `quiz:ratelimit:api:user:${userId}`;
      const result = await this.checkLimit(key, 200, 60); // 200 per minute

      res.setHeader('X-RateLimit-Limit', '200');
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', result.resetAt.toString());

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter.toString());
        
        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please slow down.',
          retryAfter: result.retryAfter
        });
      }

      next();
    };
  }

  /**
   * Rate limit tournament registration
   * 5 per hour per user
   */
  tournamentRegistration() {
    return async (req, res, next) => {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const key = `quiz:ratelimit:tournament:${userId}`;
      const result = await this.checkLimit(key, 10, 3600); // 10 per hour

      res.setHeader('X-RateLimit-Limit', '10');
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', result.resetAt.toString());

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter.toString());
        
        return res.status(429).json({
          success: false,
          message: 'Too many tournament registrations. Please wait.',
          retryAfter: result.retryAfter
        });
      }

      next();
    };
  }

  /**
   * Get rate limit status for a user
   * 
   * @param {number} userId - User ID
   * @param {string} type - Rate limit type ('answer', 'challenge', 'api', 'tournament')
   * @returns {Promise<Object>} Rate limit status
   */
  async getStatus(userId, type) {
    const configs = {
      answer: { limit: 30, window: 10 },
      challenge: { limit: 20, window: 3600 },
      api: { limit: 200, window: 60 },
      tournament: { limit: 10, window: 3600 }
    };

    const config = configs[type];
    if (!config) {
      throw new Error('Invalid rate limit type');
    }

    const key = `quiz:ratelimit:${type}:${userId}`;
    
    if (!this.initialized || !this.redis) {
      return {
        limit: config.limit,
        remaining: config.limit,
        resetAt: Date.now() + config.window * 1000
      };
    }

    try {
      const now = Date.now();
      const windowStart = now - (config.window * 1000);

      await this.redis.zremrangebyscore(key, 0, windowStart);
      const count = await this.redis.zcard(key);

      const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetAt = oldest.length > 0 ? parseInt(oldest[1]) + (config.window * 1000) : now + (config.window * 1000);

      return {
        limit: config.limit,
        remaining: Math.max(0, config.limit - count),
        resetAt
      };
    } catch (error) {
      console.error('[QuizRateLimiter] Get status error:', error);
      return {
        limit: config.limit,
        remaining: config.limit,
        resetAt: Date.now() + config.window * 1000
      };
    }
  }
}

const quizRateLimiter = new QuizRateLimiter();

module.exports = quizRateLimiter;
