const crypto = require('crypto');
const { idempotencyService } = require('./idempotencyService');

/**
 * Enhanced Webhook Security Service
 * 
 * Provides comprehensive webhook security with:
 * - Signature verification for Paystack and Stripe webhooks
 * - Replay attack protection with timestamp validation
 * - Event deduplication to prevent duplicate processing
 * - Rate limiting for webhook endpoints
 * - Comprehensive logging and monitoring
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

class WebhookSecurityService {
  constructor() {
    this.idempotencyService = idempotencyService;
    
    // Webhook security configuration
    this.config = {
      // Replay attack protection - reject webhooks older than 5 minutes
      maxTimestampAge: 5 * 60 * 1000, // 5 minutes in milliseconds
      
      // Event deduplication window - 24 hours
      deduplicationWindow: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
      
      // Rate limiting - max 100 webhooks per minute per IP
      rateLimitWindow: 60 * 1000, // 1 minute
      rateLimitMax: 100,
      
      // Supported webhook providers
      supportedProviders: ['paystack', 'stripe']
    };

    // In-memory stores (in production, use Redis)
    this.processedEvents = new Map(); // Event deduplication
    this.rateLimitStore = new Map(); // Rate limiting
    this.suspiciousIPs = new Set(); // Blocked IPs
  }

  /**
   * Verify Paystack webhook signature
   * @param {string} payload - Raw webhook payload
   * @param {string} signature - X-Paystack-Signature header
   * @param {string} secret - Paystack webhook secret
   * @returns {boolean} True if signature is valid
   */
  verifyPaystackSignature(payload, signature, secret) {
    try {
      if (!payload || !signature || !secret) {
        throw new Error('Missing required parameters for signature verification');
      }

      // Paystack uses HMAC SHA512
      const expectedSignature = crypto
        .createHmac('sha512', secret)
        .update(payload)
        .digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      console.error('[Webhook Security] Paystack signature verification error:', error);
      return false;
    }
  }

  /**
   * Verify Stripe webhook signature
   * @param {string} payload - Raw webhook payload
   * @param {string} signature - Stripe-Signature header
   * @param {string} secret - Stripe webhook secret
   * @returns {boolean} True if signature is valid
   */
  verifyStripeSignature(payload, signature, secret) {
    try {
      if (!payload || !signature || !secret) {
        throw new Error('Missing required parameters for signature verification');
      }

      // Parse Stripe signature header (format: t=timestamp,v1=signature)
      const elements = signature.split(',');
      const signatureElements = {};
      
      for (const element of elements) {
        const [key, value] = element.split('=');
        signatureElements[key] = value;
      }

      if (!signatureElements.t || !signatureElements.v1) {
        throw new Error('Invalid Stripe signature format');
      }

      const timestamp = signatureElements.t;
      const expectedSignature = signatureElements.v1;

      // Create signed payload
      const signedPayload = `${timestamp}.${payload}`;
      
      // Compute expected signature using HMAC SHA256
      const computedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

      // Use timing-safe comparison
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(computedSignature, 'hex')
      );

      // Additional timestamp validation for replay attack protection
      if (isValid) {
        const webhookTimestamp = parseInt(timestamp) * 1000; // Convert to milliseconds
        const currentTime = Date.now();
        const timeDifference = Math.abs(currentTime - webhookTimestamp);

        if (timeDifference > this.config.maxTimestampAge) {
          console.warn('[Webhook Security] Stripe webhook timestamp too old:', {
            timestamp: webhookTimestamp,
            currentTime,
            difference: timeDifference,
            maxAge: this.config.maxTimestampAge
          });
          return false;
        }
      }

      return isValid;
    } catch (error) {
      console.error('[Webhook Security] Stripe signature verification error:', error);
      return false;
    }
  }

  /**
   * Comprehensive webhook validation
   * @param {Object} params - Validation parameters
   * @param {string} params.provider - Webhook provider (paystack/stripe)
   * @param {string} params.payload - Raw webhook payload
   * @param {string} params.signature - Webhook signature header
   * @param {string} params.secret - Webhook secret
   * @param {string} params.eventId - Unique event identifier
   * @param {string} params.clientIP - Client IP address
   * @returns {Object} Validation result
   */
  async validateWebhook({ provider, payload, signature, secret, eventId, clientIP }) {
    try {
      console.log(`[Webhook Security] Validating ${provider} webhook:`, {
        eventId,
        clientIP,
        payloadLength: payload?.length || 0
      });

      // 1. Basic input validation
      if (!this.config.supportedProviders.includes(provider)) {
        throw new Error(`Unsupported webhook provider: ${provider}`);
      }

      if (!payload || !signature || !secret || !eventId) {
        throw new Error('Missing required webhook parameters');
      }

      // 2. Rate limiting check
      const rateLimitResult = this.checkRateLimit(clientIP);
      if (!rateLimitResult.allowed) {
        throw new Error(`Rate limit exceeded for IP ${clientIP}. Limit: ${this.config.rateLimitMax} per minute`);
      }

      // 3. IP blocking check
      if (this.suspiciousIPs.has(clientIP)) {
        throw new Error(`IP ${clientIP} is blocked due to suspicious activity`);
      }

      // 4. Event deduplication check
      const isDuplicate = await this.checkEventDuplication(eventId, provider);
      if (isDuplicate) {
        console.log(`[Webhook Security] Duplicate event detected: ${eventId}`);
        return {
          valid: true,
          duplicate: true,
          message: 'Event already processed'
        };
      }

      // 5. Signature verification
      let signatureValid = false;
      if (provider === 'paystack') {
        signatureValid = this.verifyPaystackSignature(payload, signature, secret);
      } else if (provider === 'stripe') {
        signatureValid = this.verifyStripeSignature(payload, signature, secret);
      }

      if (!signatureValid) {
        // Log suspicious activity
        this.logSuspiciousActivity(clientIP, provider, 'Invalid signature');
        throw new Error(`Invalid ${provider} webhook signature`);
      }

      // 6. Mark event as processed
      await this.markEventProcessed(eventId, provider);

      console.log(`[Webhook Security] ${provider} webhook validation successful:`, eventId);

      return {
        valid: true,
        duplicate: false,
        message: 'Webhook validation successful',
        rateLimitRemaining: rateLimitResult.remaining
      };

    } catch (error) {
      console.error('[Webhook Security] Validation failed:', error.message);
      
      // Log failed validation attempt
      this.logFailedValidation(clientIP, provider, error.message);
      
      return {
        valid: false,
        duplicate: false,
        message: error.message,
        error: error.message
      };
    }
  }

  /**
   * Check rate limiting for IP address
   * @param {string} clientIP - Client IP address
   * @returns {Object} Rate limit result
   */
  checkRateLimit(clientIP) {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;

    // Get or create rate limit entry for IP
    if (!this.rateLimitStore.has(clientIP)) {
      this.rateLimitStore.set(clientIP, []);
    }

    const requests = this.rateLimitStore.get(clientIP);

    // Remove old requests outside the window
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);
    
    // Check if limit exceeded
    if (recentRequests.length >= this.config.rateLimitMax) {
      // Mark IP as suspicious if consistently hitting limits
      if (recentRequests.length > this.config.rateLimitMax * 1.5) {
        this.suspiciousIPs.add(clientIP);
        console.warn(`[Webhook Security] IP ${clientIP} marked as suspicious due to excessive requests`);
      }

      return {
        allowed: false,
        remaining: 0,
        resetTime: windowStart + this.config.rateLimitWindow
      };
    }

    // Add current request
    recentRequests.push(now);
    this.rateLimitStore.set(clientIP, recentRequests);

    return {
      allowed: true,
      remaining: this.config.rateLimitMax - recentRequests.length,
      resetTime: windowStart + this.config.rateLimitWindow
    };
  }

  /**
   * Check for event deduplication
   * @param {string} eventId - Event identifier
   * @param {string} provider - Webhook provider
   * @returns {Promise<boolean>} True if event is duplicate
   */
  async checkEventDuplication(eventId, provider) {
    try {
      const eventKey = `${provider}:${eventId}`;
      
      // Check in-memory store
      if (this.processedEvents.has(eventKey)) {
        return true;
      }

      // In production, you should also check persistent storage (database/Redis)
      // For now, relying on in-memory store which is sufficient for most cases
      return false;
    } catch (error) {
      console.error('[Webhook Security] Event deduplication check error:', error);
      // On error, assume not duplicate to avoid blocking valid events
      return false;
    }
  }

  /**
   * Mark event as processed
   * @param {string} eventId - Event identifier
   * @param {string} provider - Webhook provider
   */
  async markEventProcessed(eventId, provider) {
    try {
      const eventKey = `${provider}:${eventId}`;
      const now = Date.now();

      // Store in memory with timestamp
      this.processedEvents.set(eventKey, now);

      // Clean up old events periodically
      this.cleanupOldEvents();
    } catch (error) {
      console.error('[Webhook Security] Mark event processed error:', error);
      // Don't throw - this is not critical enough to fail the webhook
    }
  }

  /**
   * Log suspicious activity
   * @param {string} clientIP - Client IP address
   * @param {string} provider - Webhook provider
   * @param {string} reason - Reason for suspicion
   */
  logSuspiciousActivity(clientIP, provider, reason) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      clientIP,
      provider,
      reason,
      type: 'suspicious_activity'
    };

    console.warn('[Webhook Security] Suspicious activity detected:', logEntry);

    // In production, send to security monitoring system
    // this.securityMonitor.alert(logEntry);
  }

  /**
   * Log failed validation attempt
   * @param {string} clientIP - Client IP address
   * @param {string} provider - Webhook provider
   * @param {string} error - Error message
   */
  logFailedValidation(clientIP, provider, error) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      clientIP,
      provider,
      error,
      type: 'validation_failure'
    };

    console.error('[Webhook Security] Validation failure:', logEntry);

    // Track failed attempts per IP
    const failureKey = `failures:${clientIP}`;
    const failures = this.rateLimitStore.get(failureKey) || 0;
    this.rateLimitStore.set(failureKey, failures + 1);

    // Block IP after too many failures
    if (failures > 10) {
      this.suspiciousIPs.add(clientIP);
      console.warn(`[Webhook Security] IP ${clientIP} blocked after ${failures} failed attempts`);
    }
  }

  /**
   * Clean up old processed events
   */
  cleanupOldEvents() {
    const now = Date.now();
    const cutoff = now - this.config.deduplicationWindow;

    // Clean up processed events
    for (const [eventKey, timestamp] of this.processedEvents.entries()) {
      if (timestamp < cutoff) {
        this.processedEvents.delete(eventKey);
      }
    }

    // Clean up rate limit store
    for (const [key, value] of this.rateLimitStore.entries()) {
      if (Array.isArray(value)) {
        // Rate limit entries
        const recentRequests = value.filter(timestamp => timestamp > cutoff);
        if (recentRequests.length === 0) {
          this.rateLimitStore.delete(key);
        } else {
          this.rateLimitStore.set(key, recentRequests);
        }
      } else if (typeof value === 'number' && key.startsWith('failures:')) {
        // Failure count entries - reset after 1 hour
        const oneHour = 60 * 60 * 1000;
        if (now - value > oneHour) {
          this.rateLimitStore.delete(key);
        }
      }
    }
  }

  /**
   * Get webhook security statistics
   * @returns {Object} Security statistics
   */
  getSecurityStats() {
    return {
      processedEvents: this.processedEvents.size,
      rateLimitedIPs: this.rateLimitStore.size,
      blockedIPs: this.suspiciousIPs.size,
      config: {
        maxTimestampAge: this.config.maxTimestampAge,
        deduplicationWindow: this.config.deduplicationWindow,
        rateLimitMax: this.config.rateLimitMax,
        supportedProviders: this.config.supportedProviders
      }
    };
  }

  /**
   * Unblock IP address (admin function)
   * @param {string} clientIP - IP address to unblock
   */
  unblockIP(clientIP) {
    this.suspiciousIPs.delete(clientIP);
    this.rateLimitStore.delete(`failures:${clientIP}`);
    console.log(`[Webhook Security] IP ${clientIP} unblocked`);
  }

  /**
   * Block IP address (admin function)
   * @param {string} clientIP - IP address to block
   * @param {string} reason - Reason for blocking
   */
  blockIP(clientIP, reason = 'Manual block') {
    this.suspiciousIPs.add(clientIP);
    this.logSuspiciousActivity(clientIP, 'manual', reason);
    console.log(`[Webhook Security] IP ${clientIP} blocked: ${reason}`);
  }
}

module.exports = WebhookSecurityService;