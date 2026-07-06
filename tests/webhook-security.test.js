const WebhookSecurityService = require('../services/webhookSecurityService');
const crypto = require('crypto');

// Mock dependencies
jest.mock('../services/idempotencyService', () => {
  return {
    IdempotencyService: jest.fn().mockImplementation(() => ({
      checkIdempotency: jest.fn().mockResolvedValue({ isUnique: true }),
      cacheResponse: jest.fn().mockResolvedValue(true)
    }))
  };
});

describe('Webhook Security Service', () => {
  let webhookSecurityService;
  const testSecret = 'test_webhook_secret_key';

  beforeEach(() => {
    webhookSecurityService = new WebhookSecurityService();
  });

  describe('Paystack Signature Verification', () => {
    test('should verify valid Paystack signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const expectedSignature = crypto
        .createHmac('sha512', testSecret)
        .update(payload)
        .digest('hex');

      const isValid = webhookSecurityService.verifyPaystackSignature(
        payload,
        expectedSignature,
        testSecret
      );

      expect(isValid).toBe(true);
    });

    test('should reject invalid Paystack signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const invalidSignature = 'invalid_signature';

      const isValid = webhookSecurityService.verifyPaystackSignature(
        payload,
        invalidSignature,
        testSecret
      );

      expect(isValid).toBe(false);
    });

    test('should handle missing parameters gracefully', () => {
      expect(webhookSecurityService.verifyPaystackSignature(null, 'sig', testSecret)).toBe(false);
      expect(webhookSecurityService.verifyPaystackSignature('payload', null, testSecret)).toBe(false);
      expect(webhookSecurityService.verifyPaystackSignature('payload', 'sig', null)).toBe(false);
    });
  });

  describe('Stripe Signature Verification', () => {
    test('should verify valid Stripe signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;
      
      const signature = crypto
        .createHmac('sha256', testSecret)
        .update(signedPayload)
        .digest('hex');
      
      const stripeSignature = `t=${timestamp},v1=${signature}`;

      const isValid = webhookSecurityService.verifyStripeSignature(
        payload,
        stripeSignature,
        testSecret
      );

      expect(isValid).toBe(true);
    });

    test('should reject old Stripe timestamps (replay attack protection)', () => {
      const payload = JSON.stringify({ test: 'data' });
      const oldTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000); // 10 minutes ago
      const signedPayload = `${oldTimestamp}.${payload}`;
      
      const signature = crypto
        .createHmac('sha256', testSecret)
        .update(signedPayload)
        .digest('hex');
      
      const stripeSignature = `t=${oldTimestamp},v1=${signature}`;

      const isValid = webhookSecurityService.verifyStripeSignature(
        payload,
        stripeSignature,
        testSecret
      );

      expect(isValid).toBe(false);
    });

    test('should reject invalid Stripe signature format', () => {
      const payload = JSON.stringify({ test: 'data' });
      const invalidSignature = 'invalid_format';

      const isValid = webhookSecurityService.verifyStripeSignature(
        payload,
        invalidSignature,
        testSecret
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    test('should allow requests within rate limit', () => {
      const clientIP = '192.168.1.1';
      
      const result = webhookSecurityService.checkRateLimit(clientIP);
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeLessThan(100);
    });

    test('should block requests exceeding rate limit', () => {
      const clientIP = '192.168.1.2';
      
      // Simulate many requests
      for (let i = 0; i < 101; i++) {
        webhookSecurityService.checkRateLimit(clientIP);
      }
      
      const result = webhookSecurityService.checkRateLimit(clientIP);
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('Event Deduplication', () => {
    test('should detect duplicate events', async () => {
      const eventId = 'test_event_123';
      const provider = 'paystack';
      
      // First check should not be duplicate
      const firstCheck = await webhookSecurityService.checkEventDuplication(eventId, provider);
      expect(firstCheck).toBe(false);
      
      // Mark as processed
      await webhookSecurityService.markEventProcessed(eventId, provider);
      
      // Second check should be duplicate
      const secondCheck = await webhookSecurityService.checkEventDuplication(eventId, provider);
      expect(secondCheck).toBe(true);
    });
  });

  describe('IP Management', () => {
    test('should block and unblock IP addresses', () => {
      const testIP = '192.168.1.100';
      
      // Initially not blocked
      expect(webhookSecurityService.suspiciousIPs.has(testIP)).toBe(false);
      
      // Block IP
      webhookSecurityService.blockIP(testIP, 'Test block');
      expect(webhookSecurityService.suspiciousIPs.has(testIP)).toBe(true);
      
      // Unblock IP
      webhookSecurityService.unblockIP(testIP);
      expect(webhookSecurityService.suspiciousIPs.has(testIP)).toBe(false);
    });
  });

  describe('Comprehensive Webhook Validation', () => {
    test('should validate webhook with all security checks', async () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto
        .createHmac('sha512', testSecret)
        .update(payload)
        .digest('hex');

      const result = await webhookSecurityService.validateWebhook({
        provider: 'paystack',
        payload,
        signature,
        secret: testSecret,
        eventId: 'test_event_456',
        clientIP: '192.168.1.3'
      });

      expect(result.valid).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(result.message).toBe('Webhook validation successful');
    });

    test('should reject webhook with invalid signature', async () => {
      const result = await webhookSecurityService.validateWebhook({
        provider: 'paystack',
        payload: JSON.stringify({ test: 'data' }),
        signature: 'invalid_signature',
        secret: testSecret,
        eventId: 'test_event_789',
        clientIP: '192.168.1.4'
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Invalid paystack webhook signature');
    });

    test('should reject webhook from blocked IP', async () => {
      const blockedIP = '192.168.1.5';
      webhookSecurityService.blockIP(blockedIP, 'Test block');

      const result = await webhookSecurityService.validateWebhook({
        provider: 'paystack',
        payload: JSON.stringify({ test: 'data' }),
        signature: 'any_signature',
        secret: testSecret,
        eventId: 'test_event_blocked',
        clientIP: blockedIP
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain('blocked due to suspicious activity');
    });
  });

  describe('Security Statistics', () => {
    test('should return security statistics', () => {
      const stats = webhookSecurityService.getSecurityStats();
      
      expect(stats).toHaveProperty('processedEvents');
      expect(stats).toHaveProperty('rateLimitedIPs');
      expect(stats).toHaveProperty('blockedIPs');
      expect(stats).toHaveProperty('config');
      expect(stats.config).toHaveProperty('supportedProviders');
      expect(stats.config.supportedProviders).toContain('paystack');
      expect(stats.config.supportedProviders).toContain('stripe');
    });
  });
});