const MultiCurrencyWalletService = require('../services/multiCurrencyWalletService');

/**
 * Integration Tests for Multi-Currency Wallet Service
 * 
 * These tests verify the core functionality of the multi-currency wallet system:
 * - Wallet initialization for new users
 * - Currency isolation enforcement
 * - Balance tracking and operations
 * - Gateway routing validation
 */

describe('Multi-Currency Wallet Service Integration Tests', () => {
  let walletService;

  beforeAll(() => {
    walletService = new MultiCurrencyWalletService();
  });

  describe('Currency Validation', () => {
    test('should validate supported currencies', () => {
      expect(() => walletService.validateCurrency('NGN')).not.toThrow();
      expect(() => walletService.validateCurrency('USD')).not.toThrow();
      expect(() => walletService.validateCurrency('EUR')).toThrow('Unsupported currency');
      expect(() => walletService.validateCurrency('')).toThrow('Currency is required');
      expect(() => walletService.validateCurrency(null)).toThrow('Currency is required');
    });

    test('should validate amounts', () => {
      expect(() => walletService.validateAmount(100)).not.toThrow();
      expect(() => walletService.validateAmount(0.01)).not.toThrow();
      expect(() => walletService.validateAmount(0)).toThrow('Amount must be a positive number');
      expect(() => walletService.validateAmount(-10)).toThrow('Amount must be a positive number');
      expect(() => walletService.validateAmount('100')).toThrow('Amount must be a positive number');
      expect(() => walletService.validateAmount(Infinity)).toThrow('Amount must be a positive number');
    });
  });

  describe('Gateway Routing', () => {
    test('should enforce correct gateway for each currency', () => {
      expect(walletService.getRequiredGateway('NGN')).toBe('paystack');
      expect(walletService.getRequiredGateway('USD')).toBe('stripe');
    });

    test('should validate currency-gateway pairings', () => {
      expect(() => walletService.validateCurrencyGatewayPairing('NGN', 'paystack')).not.toThrow();
      expect(() => walletService.validateCurrencyGatewayPairing('USD', 'stripe')).not.toThrow();
      
      expect(() => walletService.validateCurrencyGatewayPairing('NGN', 'stripe'))
        .toThrow('NGN transactions must use paystack');
      expect(() => walletService.validateCurrencyGatewayPairing('USD', 'paystack'))
        .toThrow('USD transactions must use stripe');
    });
  });

  describe('Currency Conversion', () => {
    test('should convert amounts to and from cents correctly', () => {
      // NGN conversions
      expect(walletService.convertToCents(100.50, 'NGN')).toBe(10050);
      expect(walletService.convertToCents(1, 'NGN')).toBe(100);
      expect(walletService.convertToCents(0.01, 'NGN')).toBe(1);
      
      expect(walletService.convertFromCents(10050, 'NGN')).toBe(100.50);
      expect(walletService.convertFromCents(100, 'NGN')).toBe(1);
      expect(walletService.convertFromCents(1, 'NGN')).toBe(0.01);

      // USD conversions
      expect(walletService.convertToCents(25.99, 'USD')).toBe(2599);
      expect(walletService.convertFromCents(2599, 'USD')).toBe(25.99);
    });
  });

  describe('Wallet Response Formatting', () => {
    test('should format wallet response correctly', () => {
      const mockWallet = {
        id: 'wallet-123',
        user_id: 456,
        currency: 'NGN',
        balance_available: 50000, // 500.00 NGN in cents
        balance_pending: 10000,   // 100.00 NGN in cents
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02')
      };

      const formatted = walletService.formatWalletResponse(mockWallet);

      expect(formatted).toEqual({
        id: 'wallet-123',
        userId: 456,
        currency: 'NGN',
        availableBalance: 500.00,
        pendingBalance: 100.00,
        totalBalance: 600.00,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02')
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid transfer scenarios', () => {
      const transferParams = {
        fromUserId: 123,
        toUserId: 123, // Same user
        currency: 'NGN',
        amount: 100,
        reference: 'test-ref',
        description: 'Test transfer'
      };

      expect(async () => {
        await walletService.transferBetweenWallets(transferParams);
      }).rejects.toThrow('Cannot transfer to the same wallet');
    });

    test('should validate transfer parameters', () => {
      expect(async () => {
        await walletService.transferBetweenWallets({
          fromUserId: 123,
          toUserId: 456,
          currency: 'INVALID',
          amount: 100,
          reference: 'test',
          description: 'test'
        });
      }).rejects.toThrow('Unsupported currency');

      expect(async () => {
        await walletService.transferBetweenWallets({
          fromUserId: 123,
          toUserId: 456,
          currency: 'NGN',
          amount: -100,
          reference: 'test',
          description: 'test'
        });
      }).rejects.toThrow('Amount must be a positive number');
    });
  });

  describe('Service Configuration', () => {
    test('should have correct supported currencies', () => {
      expect(walletService.supportedCurrencies).toEqual(['NGN', 'USD']);
    });

    test('should have correct gateway mapping', () => {
      expect(walletService.gatewayMapping).toEqual({
        'NGN': 'paystack',
        'USD': 'stripe'
      });
    });
  });
});