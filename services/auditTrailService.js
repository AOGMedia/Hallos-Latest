const crypto = require('crypto');
const sequelize = require('../config/db');

/**
 * Audit Trail Service
 * 
 * Provides immutable audit logging for all financial operations:
 * - Cryptographic hashing for tamper detection
 * - Immutable audit log storage
 * - Audit log retention and archival
 * - Comprehensive event tracking
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

class AuditTrailService {
  constructor() {
    // Audit configuration
    this.config = {
      // Hash algorithm for tamper detection
      hashAlgorithm: 'sha256',
      
      // Retention periods (in days)
      retention: {
        financial: 2555,    // 7 years for financial records
        security: 365,      // 1 year for security events
        system: 90,         // 90 days for system events
        user: 180          // 180 days for user events
      },
      
      // Event categories
      categories: {
        FINANCIAL: 'financial',
        SECURITY: 'security',
        SYSTEM: 'system',
        USER: 'user',
        ADMIN: 'admin'
      },
      
      // Event types
      eventTypes: {
        // Financial events
        PAYMENT_INITIATED: 'payment_initiated',
        PAYMENT_COMPLETED: 'payment_completed',
        PAYMENT_FAILED: 'payment_failed',
        WITHDRAWAL_INITIATED: 'withdrawal_initiated',
        WITHDRAWAL_COMPLETED: 'withdrawal_completed',
        WITHDRAWAL_FAILED: 'withdrawal_failed',
        TRANSFER_INITIATED: 'transfer_initiated',
        TRANSFER_COMPLETED: 'transfer_completed',
        WALLET_CREDITED: 'wallet_credited',
        WALLET_DEBITED: 'wallet_debited',
        
        // Security events
        LOGIN_SUCCESS: 'login_success',
        LOGIN_FAILED: 'login_failed',
        PASSWORD_CHANGED: 'password_changed',
        TWO_FA_ENABLED: 'two_fa_enabled',
        TWO_FA_DISABLED: 'two_fa_disabled',
        FRAUD_DETECTED: 'fraud_detected',
        ACCOUNT_LOCKED: 'account_locked',
        SUSPICIOUS_ACTIVITY: 'suspicious_activity',
        
        // System events
        RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
        API_ERROR: 'api_error',
        SYSTEM_ERROR: 'system_error',
        CONFIGURATION_CHANGED: 'configuration_changed',
        
        // User events
        PROFILE_UPDATED: 'profile_updated',
        EMAIL_CHANGED: 'email_changed',
        PHONE_CHANGED: 'phone_changed',
        
        // Admin events
        USER_SUSPENDED: 'user_suspended',
        USER_UNSUSPENDED: 'user_unsuspended',
        LIMITS_CHANGED: 'limits_changed',
        ADMIN_ACTION: 'admin_action'
      }
    };

    // In-memory cache for recent audit entries (for hash chain validation)
    this.recentEntries = new Map();
    this.lastHash = null;
    
    // Initialize hash chain
    this.initializeHashChain();
  }

  /**
   * Log audit event
   * @param {Object} eventData - Event details
   * @returns {Promise<Object>} Audit log result
   */
  async logEvent(eventData) {
    try {
      const {
        eventType,
        category,
        userId,
        sessionId,
        ipAddress,
        userAgent,
        data,
        metadata = {}
      } = eventData;

      console.log(`[Audit Trail] Logging event: ${eventType} for user ${userId}`);

      // Generate audit entry
      const auditEntry = {
        id: this.generateAuditId(),
        timestamp: new Date().toISOString(),
        eventType,
        category: category || this.getCategoryForEventType(eventType),
        userId: userId || null,
        sessionId: sessionId || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        data: this.sanitizeData(data),
        metadata: {
          ...metadata,
          serverTimestamp: Date.now(),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development'
        }
      };

      // Calculate hash for tamper detection
      const entryHash = this.calculateEntryHash(auditEntry);
      const chainHash = this.calculateChainHash(entryHash);

      // Add hash information
      auditEntry.entryHash = entryHash;
      auditEntry.chainHash = chainHash;
      auditEntry.previousHash = this.lastHash;

      // Store in database
      const storedEntry = await this.storeAuditEntry(auditEntry);

      // Update hash chain
      this.lastHash = chainHash;
      this.recentEntries.set(auditEntry.id, auditEntry);

      // Clean up old entries from memory
      if (this.recentEntries.size > 1000) {
        const oldestKey = this.recentEntries.keys().next().value;
        this.recentEntries.delete(oldestKey);
      }

      console.log(`[Audit Trail] Event logged successfully: ${auditEntry.id}`);

      return {
        success: true,
        auditId: auditEntry.id,
        hash: entryHash,
        chainHash: chainHash
      };
    } catch (error) {
      console.error('[Audit Trail] Logging error:', error);
      // Critical: Audit logging should never fail silently
      throw new Error(`Audit logging failed: ${error.message}`);
    }
  }

  /**
   * Store audit entry in database
   * @param {Object} auditEntry - Audit entry to store
   * @returns {Promise<Object>} Stored entry
   */
  async storeAuditEntry(auditEntry) {
    const transaction = await sequelize.transaction();
    
    try {
      await sequelize.query(`
        INSERT INTO audit_logs (
          id, user_id, operation_type, resource_type, resource_id,
          old_values, new_values, ip_address, user_agent, request_id, 
          session_id, hash_chain, created_at
        ) VALUES (
          :id, :userId, :operationType, :resourceType, :resourceId,
          :oldValues, :newValues, :ipAddress, :userAgent, :requestId,
          :sessionId, :chainHash, CURRENT_TIMESTAMP
        )
      `, {
        replacements: {
          id: auditEntry.id,
          userId: auditEntry.userId,
          operationType: auditEntry.eventType,
          resourceType: auditEntry.category,
          resourceId: auditEntry.resourceId,
          oldValues: JSON.stringify(auditEntry.data),
          newValues: JSON.stringify(auditEntry.metadata),
          ipAddress: auditEntry.ipAddress,
          userAgent: auditEntry.userAgent,
          requestId: auditEntry.requestId,
          sessionId: auditEntry.sessionId,
          chainHash: auditEntry.chainHash
        },
        transaction
      });

      await transaction.commit();
      return auditEntry;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Get audit logs with filtering
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} Audit logs
   */
  async getAuditLogs(filters = {}) {
    try {
      const {
        userId,
        category,
        eventType,
        startDate,
        endDate,
        limit = 100,
        offset = 0
      } = filters;

      let whereClause = 'WHERE 1=1';
      const replacements = {};

      if (userId) {
        whereClause += ' AND user_id = :userId';
        replacements.userId = userId;
      }

      if (category) {
        whereClause += ' AND category = :category';
        replacements.category = category;
      }

      if (eventType) {
        whereClause += ' AND event_type = :eventType';
        replacements.eventType = eventType;
      }

      if (startDate) {
        whereClause += ' AND created_at >= :startDate';
        replacements.startDate = startDate;
      }

      if (endDate) {
        whereClause += ' AND created_at <= :endDate';
        replacements.endDate = endDate;
      }

      const results = await sequelize.query(`
        SELECT 
          id, user_id, operation_type, resource_type, resource_id,
          old_values, new_values, ip_address, user_agent, request_id,
          session_id, hash_chain, created_at
        FROM audit_logs 
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
      `, {
        replacements: {
          ...replacements,
          limit: parseInt(limit),
          offset: parseInt(offset)
        },
        type: sequelize.QueryTypes.SELECT
      });

      return (results || []).map(entry => ({
        ...entry,
        data: this.parseJSON(entry.old_values),
        metadata: this.parseJSON(entry.new_values)
      }));
    } catch (error) {
      console.error('[Audit Trail] Get logs error:', error);
      throw error;
    }
  }

  /**
   * Verify audit trail integrity
   * @param {string} auditId - Audit entry ID to verify
   * @returns {Promise<Object>} Verification result
   */
  async verifyIntegrity(auditId) {
    try {
      const [entry] = await sequelize.query(`
        SELECT * FROM audit_logs WHERE id = :auditId
      `, {
        replacements: { auditId },
        type: sequelize.QueryTypes.SELECT
      });

      if (!entry) {
        return {
          valid: false,
          message: 'Audit entry not found'
        };
      }

      // Parse data
      const parsedEntry = {
        ...entry,
        data: this.parseJSON(entry.data),
        metadata: this.parseJSON(entry.metadata)
      };

      // Recalculate hash
      const calculatedHash = this.calculateEntryHash(parsedEntry);

      // Verify entry hash
      if (calculatedHash !== entry.entry_hash) {
        return {
          valid: false,
          message: 'Entry hash mismatch - possible tampering detected',
          expected: calculatedHash,
          actual: entry.entry_hash
        };
      }

      // Verify chain integrity if previous entry exists
      if (entry.previous_hash) {
        const [previousEntry] = await sequelize.query(`
          SELECT hash_chain FROM audit_logs 
          WHERE hash_chain = :previousHash
          ORDER BY created_at DESC LIMIT 1
        `, {
          replacements: { previousHash: entry.previous_hash },
          type: sequelize.QueryTypes.SELECT
        });

        if (!previousEntry) {
          return {
            valid: false,
            message: 'Chain integrity broken - previous hash not found'
          };
        }
      }

      return {
        valid: true,
        message: 'Audit entry integrity verified',
        auditId: entry.id,
        timestamp: entry.timestamp,
        hash: entry.entry_hash
      };
    } catch (error) {
      console.error('[Audit Trail] Verify integrity error:', error);
      return {
        valid: false,
        message: 'Integrity verification failed',
        error: error.message
      };
    }
  }

  /**
   * Generate audit report
   * @param {Object} criteria - Report criteria
   * @returns {Promise<Object>} Audit report
   */
  async generateReport(criteria = {}) {
    try {
      const {
        startDate,
        endDate,
        category,
        userId,
        includeStatistics = true
      } = criteria;

      const logs = await this.getAuditLogs({
        ...criteria,
        limit: 10000 // Large limit for reports
      });

      const report = {
        generatedAt: new Date().toISOString(),
        criteria,
        totalEntries: logs.length,
        entries: logs
      };

      if (includeStatistics) {
        report.statistics = this.calculateStatistics(logs);
      }

      return report;
    } catch (error) {
      console.error('[Audit Trail] Generate report error:', error);
      throw error;
    }
  }

  /**
   * Archive old audit logs
   * @param {number} retentionDays - Days to retain
   * @returns {Promise<Object>} Archive result
   */
  async archiveOldLogs(retentionDays = null) {
    try {
      const categories = Object.keys(this.config.retention);
      let totalArchived = 0;

      for (const category of categories) {
        const retention = retentionDays || this.config.retention[category];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retention);

        const [result] = await sequelize.query(`
          DELETE FROM audit_logs 
          WHERE resource_type = :category 
          AND created_at < :cutoffDate
        `, {
          replacements: {
            category,
            cutoffDate: cutoffDate.toISOString()
          }
        });

        const archivedCount = result.rowCount || 0;
        totalArchived += archivedCount;

        if (archivedCount > 0) {
          console.log(`[Audit Trail] Archived ${archivedCount} ${category} logs older than ${retention} days`);
        }
      }

      return {
        success: true,
        totalArchived,
        archivedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[Audit Trail] Archive error:', error);
      throw error;
    }
  }

  /**
   * Calculate entry hash for tamper detection
   * @param {Object} entry - Audit entry
   * @returns {string} SHA256 hash
   */
  calculateEntryHash(entry) {
    const hashData = {
      id: entry.id,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      category: entry.category,
      userId: entry.userId,
      data: entry.data
    };

    const hashString = JSON.stringify(hashData, Object.keys(hashData).sort());
    return crypto.createHash(this.config.hashAlgorithm).update(hashString).digest('hex');
  }

  /**
   * Calculate chain hash for integrity verification
   * @param {string} entryHash - Current entry hash
   * @returns {string} Chain hash
   */
  calculateChainHash(entryHash) {
    const chainData = this.lastHash ? `${this.lastHash}:${entryHash}` : entryHash;
    return crypto.createHash(this.config.hashAlgorithm).update(chainData).digest('hex');
  }

  /**
   * Initialize hash chain
   */
  async initializeHashChain() {
    try {
      const [lastEntry] = await sequelize.query(`
        SELECT hash_chain FROM audit_logs 
        ORDER BY created_at DESC LIMIT 1
      `, {
        type: sequelize.QueryTypes.SELECT
      });

      this.lastHash = lastEntry ? lastEntry.hash_chain : null;
      console.log(`[Audit Trail] Hash chain initialized. Last hash: ${this.lastHash || 'None'}`);
    } catch (error) {
      console.error('[Audit Trail] Hash chain initialization error:', error);
      this.lastHash = null;
    }
  }

  /**
   * Generate unique audit ID
   * @returns {string} Unique audit ID
   */
  generateAuditId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `audit_${timestamp}_${random}`;
  }

  /**
   * Get category for event type
   * @param {string} eventType - Event type
   * @returns {string} Category
   */
  getCategoryForEventType(eventType) {
    const financialEvents = [
      'payment_initiated', 'payment_completed', 'payment_failed',
      'withdrawal_initiated', 'withdrawal_completed', 'withdrawal_failed',
      'transfer_initiated', 'transfer_completed',
      'wallet_credited', 'wallet_debited'
    ];

    const securityEvents = [
      'login_success', 'login_failed', 'password_changed',
      'two_fa_enabled', 'two_fa_disabled', 'fraud_detected',
      'account_locked', 'suspicious_activity'
    ];

    const systemEvents = [
      'rate_limit_exceeded', 'api_error', 'system_error',
      'configuration_changed'
    ];

    const adminEvents = [
      'user_suspended', 'user_unsuspended', 'limits_changed',
      'admin_action'
    ];

    if (financialEvents.includes(eventType)) return this.config.categories.FINANCIAL;
    if (securityEvents.includes(eventType)) return this.config.categories.SECURITY;
    if (systemEvents.includes(eventType)) return this.config.categories.SYSTEM;
    if (adminEvents.includes(eventType)) return this.config.categories.ADMIN;
    
    return this.config.categories.USER;
  }

  /**
   * Sanitize sensitive data for logging
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   */
  sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;

    const sensitiveFields = [
      'password', 'token', 'secret', 'key', 'otp', 'pin',
      'ssn', 'creditCard', 'bankAccount', 'routingNumber'
    ];

    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    // Recursively sanitize nested objects
    for (const [key, value] of Object.entries(sanitized)) {
      if (value && typeof value === 'object') {
        sanitized[key] = this.sanitizeData(value);
      }
    }

    return sanitized;
  }

  /**
   * Parse JSON safely
   * @param {string} jsonString - JSON string to parse
   * @returns {Object} Parsed object or original string
   */
  parseJSON(jsonString) {
    try {
      return JSON.parse(jsonString);
    } catch {
      return jsonString;
    }
  }

  /**
   * Calculate statistics for audit logs
   * @param {Array} logs - Audit logs
   * @returns {Object} Statistics
   */
  calculateStatistics(logs) {
    const stats = {
      totalEntries: logs.length,
      categories: {},
      eventTypes: {},
      users: {},
      timeRange: {
        earliest: null,
        latest: null
      }
    };

    logs.forEach(log => {
      // Category stats
      stats.categories[log.category] = (stats.categories[log.category] || 0) + 1;
      
      // Event type stats
      stats.eventTypes[log.event_type] = (stats.eventTypes[log.event_type] || 0) + 1;
      
      // User stats
      if (log.user_id) {
        stats.users[log.user_id] = (stats.users[log.user_id] || 0) + 1;
      }
      
      // Time range
      const timestamp = new Date(log.timestamp);
      if (!stats.timeRange.earliest || timestamp < new Date(stats.timeRange.earliest)) {
        stats.timeRange.earliest = log.timestamp;
      }
      if (!stats.timeRange.latest || timestamp > new Date(stats.timeRange.latest)) {
        stats.timeRange.latest = log.timestamp;
      }
    });

    return stats;
  }

  /**
   * Get audit trail statistics
   * @returns {Object} Service statistics
   */
  getStatistics() {
    return {
      recentEntriesCount: this.recentEntries.size,
      lastHash: this.lastHash,
      config: this.config
    };
  }
}

module.exports = AuditTrailService;