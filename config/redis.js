const Redis = require('ioredis');

/**
 * Centralized Redis Configuration
 * 
 * Supports two connection methods:
 * 1. Connection URL (REDIS_URL) - Recommended for cloud providers like Upstash
 * 2. Individual credentials - Fallback for local/custom setups
 * 
 * Features:
 * - Automatic TLS support for Upstash and other cloud providers
 * - Connection retry with exponential backoff
 * - Error handling and logging
 * - Singleton pattern for connection reuse
 */

let redisClient = null;

/**
 * Get Redis configuration from environment variables
 * @returns {Object} Redis configuration object
 */
function getRedisConfig() {
  // Option 1: Use connection URL (preferred for Upstash)
  if (process.env.REDIS_URL) {
    console.log('[Redis] Using REDIS_URL for connection');
    const isTLS = process.env.REDIS_URL.startsWith('rediss://');
    return {
      url: process.env.REDIS_URL,
      tls: isTLS ? { rejectUnauthorized: false } : undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false
    };
  }

  // Option 2: Use individual credentials
  console.log('[Redis] Using individual credentials for connection');
  const config = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    username: process.env.REDIS_USERNAME || undefined,
    db: parseInt(process.env.REDIS_QUIZ_DB || '0', 10),
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false
  };

  // Add TLS if specified
  if (process.env.REDIS_TLS === 'true') {
    config.tls = {};
  }

  return config;
}

/**
 * Create a new Redis client instance
 * @param {number} db - Database number (optional, overrides env)
 * @returns {Redis} Redis client instance
 */
function createRedisClient(db = null) {
  const url = process.env.REDIS_URL;

  let client;

  if (url) {
    console.log('[Redis] Connecting via REDIS_URL');
    client = new Redis(url, {
      tls: { rejectUnauthorized: false },
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true
    });
  } else {
    console.log('[Redis] Connecting via individual credentials');
    const config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      username: process.env.REDIS_USERNAME || undefined,
      db: db !== null ? db : parseInt(process.env.REDIS_QUIZ_DB || '0', 10),
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true
    };
    if (process.env.REDIS_TLS === 'true') {
      config.tls = { rejectUnauthorized: false };
    }
    client = new Redis(config);
  }

  // Event handlers
  client.on('connect', () => {
    console.log('✅ Redis: Connected successfully');
  });

  client.on('ready', () => {
    console.log('✅ Redis: Ready to accept commands');
  });

  client.on('error', (err) => {
    console.error('❌ Redis: Connection error:', err.message || err.code || err);
  });

  client.on('close', () => {
    console.log('🔌 Redis: Connection closed');
  });

  client.on('reconnecting', (delay) => {
    console.log(`🔄 Redis: Reconnecting in ${delay}ms...`);
  });

  return client;
}

/**
 * Get or create singleton Redis client
 * @returns {Redis} Redis client instance
 */
function getRedisClient() {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

/**
 * Close Redis connection
 */
async function closeRedisConnection() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('✅ Redis: Connection closed gracefully');
  }
}

/**
 * Test Redis connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testRedisConnection() {
  try {
    const client = getRedisClient();
    await client.ping();
    console.log('✅ Redis: Connection test successful');
    return true;
  } catch (error) {
    console.error('❌ Redis: Connection test failed:', error.message);
    return false;
  }
}

/**
 * Get Redis connection info
 * @returns {Object} Connection information
 */
function getRedisInfo() {
  const config = getRedisConfig();
  
  if (config.url) {
    // Parse URL to extract host (hide password)
    const url = new URL(config.url);
    return {
      type: 'url',
      host: url.hostname,
      port: url.port,
      tls: config.tls !== undefined,
      database: 0 // URL connections typically use db 0
    };
  }

  return {
    type: 'credentials',
    host: config.host,
    port: config.port,
    tls: config.tls !== undefined,
    database: config.db
  };
}

module.exports = {
  createRedisClient,
  getRedisClient,
  closeRedisConnection,
  testRedisConnection,
  getRedisInfo,
  getRedisConfig
};

