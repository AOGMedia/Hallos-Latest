const { v4: uuidv4 } = require('uuid');
const sequelize = require('../config/db');

/**
 * Idempotency Manager Service
 * 
 * Ensures financial operations execute exactly once by tracking idempotency keys
 * and caching operation results for 24 hours.
 */
class IdempotencyService {
  
  /**
   * Check if an idempotency key exists and store it if new
   * @param {string} key - UUID idempotency key
   * @param {number} userId - User ID performing the operation
   * @param {string} operationType - Type of operation (withdrawal, payment, etc.)
   * @param {object} operationData - Operation parameters
   * @returns {Promise<{isNew: boolean, storedResult?: any, lockAcquired: boolean}>}
   */
  async checkAndStore(key, userId, operationType, operationData) {
    const transaction = await sequelize.transaction();
    
    try {
      // Validate inputs
      if (!key || !this.isValidUUID(key)) {
        throw new Error('Invalid idempotency key format');
      }
      
      if (!operationType || !operationData) {
        throw new Error('Missing required parameters for idempotency check');
      }
      
      // For payment verification, userId might not be available initially
      if (operationType !== 'payment_verification' && !userId) {
        throw new Error('Missing required parameters for idempotency check');
      }
      
      // Check if key already exists
      const [existingRecord] = await sequelize.query(`
        SELECT key, status, result_data, operation_data, user_id, created_at
        FROM idempotency_keys 
        WHERE key = :key
        FOR UPDATE
      `, {
        replacements: { key },
        transaction,
        type: sequelize.QueryTypes.SELECT
      });
      
      if (existingRecord) {
        // Validate that the operation parameters match
        if (!this.operationsMatch(existingRecord.operation_data, operationData)) {
          await transaction.rollback();
          throw new IdempotencyConflictError(
            `Idempotency key ${key} already used with different parameters`
          );
        }
        
        // Validate that the user matches (skip for payment verification)
        if (operationType !== 'payment_verification' && existingRecord.user_id !== userId) {
          await transaction.rollback();
          throw new IdempotencyConflictError(
            `Idempotency key ${key} belongs to a different user`
          );
        }
        
        // Check if key has expired
        const expirationTime = new Date(existingRecord.created_at);
        expirationTime.setHours(expirationTime.getHours() + 24);
        
        if (new Date() > expirationTime) {
          await transaction.rollback();
          // Key has expired, allow new operation
          await this.invalidateKey(key);
          return await this.checkAndStore(key, userId, operationType, operationData);
        }
        
        await transaction.commit();
        
        return {
          isNew: false,
          storedResult: existingRecord.result_data,
          lockAcquired: false,
          status: existingRecord.status
        };
      }
      
      // Create new idempotency record
      await sequelize.query(`
        INSERT INTO idempotency_keys (key, user_id, operation_type, operation_data, status, created_at, expires_at)
        VALUES (:key, :userId, :operationType, :operationData, 'processing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours')
      `, {
        replacements: {
          key,
          userId,
          operationType,
          operationData: JSON.stringify(operationData)
        },
        transaction
      });
      
      await transaction.commit();
      
      return {
        isNew: true,
        storedResult: null,
        lockAcquired: true,
        status: 'processing'
      };
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  
  /**
   * Store the result of a completed operation
   * @param {string} key - Idempotency key
   * @param {any} result - Operation result to cache
   * @param {string} status - Operation status ('completed' or 'failed')
   */
  async storeResult(key, result, status = 'completed') {
    try {
      if (!['completed', 'failed'].includes(status)) {
        throw new Error('Invalid status. Must be "completed" or "failed"');
      }
      
      await sequelize.query(`
        UPDATE idempotency_keys 
        SET result_data = :result, status = :status
        WHERE key = :key
      `, {
        replacements: {
          key,
          result: JSON.stringify(result),
          status
        }
      });
      
    } catch (error) {
      console.error('Error storing idempotency result:', error);
      throw error;
    }
  }
  
  /**
   * Get stored result for an idempotency key
   * @param {string} key - Idempotency key
   * @returns {Promise<object|null>} Stored result or null if not found
   */
  async getStoredResult(key) {
    try {
      const [record] = await sequelize.query(`
        SELECT result_data, status, created_at
        FROM idempotency_keys 
        WHERE key = :key
      `, {
        replacements: { key },
        type: sequelize.QueryTypes.SELECT
      });
      
      if (!record) {
        return null;
      }
      
      // Check if expired
      const expirationTime = new Date(record.created_at);
      expirationTime.setHours(expirationTime.getHours() + 24);
      
      if (new Date() > expirationTime) {
        await this.invalidateKey(key);
        return null;
      }
      
      return {
        result: record.result_data,
        status: record.status
      };
      
    } catch (error) {
      console.error('Error getting stored result:', error);
      throw error;
    }
  }
  
  /**
   * Invalidate an idempotency key (remove from storage)
   * @param {string} key - Idempotency key to invalidate
   */
  async invalidateKey(key) {
    try {
      await sequelize.query(`
        DELETE FROM idempotency_keys 
        WHERE key = :key
      `, {
        replacements: { key }
      });
      
    } catch (error) {
      console.error('Error invalidating idempotency key:', error);
      throw error;
    }
  }
  
  /**
   * Clean up expired idempotency keys (should be run periodically)
   */
  async cleanupExpiredKeys() {
    try {
      const [result] = await sequelize.query(`
        DELETE FROM idempotency_keys 
        WHERE expires_at < CURRENT_TIMESTAMP
      `);
      
      console.log(`Cleaned up ${result.rowCount || 0} expired idempotency keys`);
      return result.rowCount || 0;
      
    } catch (error) {
      console.error('Error cleaning up expired keys:', error);
      throw error;
    }
  }
  
  /**
   * Generate a new UUID for use as idempotency key
   * @returns {string} New UUID
   */
  generateKey() {
    return uuidv4();
  }
  
  /**
   * Validate UUID format
   * @param {string} uuid - UUID to validate
   * @returns {boolean} True if valid UUID
   */
  isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
  
  /**
   * Compare two operation data objects for equality
   * @param {object} op1 - First operation data
   * @param {object} op2 - Second operation data
   * @returns {boolean} True if operations match
   */
  operationsMatch(op1, op2) {
    try {
      // Parse if strings
      const parsed1 = typeof op1 === 'string' ? JSON.parse(op1) : op1;
      const parsed2 = typeof op2 === 'string' ? JSON.parse(op2) : op2;
      
      // Deep comparison of operation parameters
      return JSON.stringify(this.sortObject(parsed1)) === JSON.stringify(this.sortObject(parsed2));
      
    } catch (error) {
      console.error('Error comparing operations:', error);
      return false;
    }
  }
  
  /**
   * Sort object keys recursively for consistent comparison
   * @param {object} obj - Object to sort
   * @returns {object} Sorted object
   */
  sortObject(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObject(item));
    }
    
    const sortedKeys = Object.keys(obj).sort();
    const sortedObj = {};
    
    for (const key of sortedKeys) {
      sortedObj[key] = this.sortObject(obj[key]);
    }
    
    return sortedObj;
  }
}

/**
 * Custom error for idempotency conflicts
 */
class IdempotencyConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.statusCode = 409;
  }
}

// Export singleton instance
const idempotencyService = new IdempotencyService();

module.exports = {
  idempotencyService,
  IdempotencyConflictError
};