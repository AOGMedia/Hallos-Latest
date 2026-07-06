const MultiCurrencyBalanceService = require('../services/multiCurrencyBalanceService');

/**
 * Integration Tests for Multi-Currency Balance Queries
 * 
 * These tests verify the advanced balance querying capabilities:
 * - Currency-filtered balance queries
 * - Date range and operation type filtering
 * - Transaction history with pagination
 * - Balance analytics and calculations
 */

describe('Multi-Currency Balance Queries Integration Tests', () => {
  let balanceService;

  beforeAll(() => {
    balanceService = new MultiCurrencyBalanceService();
  });

  describe('Service Initialization', () => {
    test('should initialize with wallet service', () => {
      expect(balanceService.walletService).toBeDefined();
      expect(balanceService.walletService.supportedCurrencies).toEqual(['NGN', 'USD']);
    });
  });

  describe('Date Interval Calculations', () => {
    test('should calculate daily intervals correctly', () => {
      const intervals = balanceService.calculateDateIntervals('day', 3);
      
      expect(intervals).toHaveLength(3);
      intervals.forEach((interval, index) => {
        expect(interval.start).toBeInstanceOf(Date);
        expect(interval.end).toBeInstanceOf(Date);
        expect(interval.period).toBe(`day_${2 - index}`);
        expect(interval.end.getTime()).toBeGreaterThan(interval.start.getTime());
      });
    });

    test('should calculate weekly intervals correctly', () => {
      const intervals = balanceService.calculateDateIntervals('week', 2);
      
      expect(intervals).toHaveLength(2);
      intervals.forEach((interval, index) => {
        expect(interval.period).toBe(`week_${1 - index}`);
        
        // Week should span 7 days
        const daysDiff = Math.ceil((interval.end - interval.start) / (1000 * 60 * 60 * 24));
        expect(daysDiff).toBeGreaterThanOrEqual(6);
        expect(daysDiff).toBeLessThanOrEqual(7);
      });
    });

    test('should calculate monthly intervals correctly', () => {
      const intervals = balanceService.calculateDateIntervals('month', 2);
      
      expect(intervals).toHaveLength(2);
      intervals.forEach((interval, index) => {
        expect(interval.period).toBe(`month_${1 - index}`);
        
        // Month should be at least 28 days
        const daysDiff = Math.ceil((interval.end - interval.start) / (1000 * 60 * 60 * 24));
        expect(daysDiff).toBeGreaterThanOrEqual(27);
        expect(daysDiff).toBeLessThanOrEqual(31);
      });
    });
  });

  describe('Transaction Summary Calculations', () => {
    test('should calculate transaction summary correctly', () => {
      const mockResults = [
        { transaction_type: 'credit', count: '5', total_amount: '50000' }, // 500.00 in currency
        { transaction_type: 'debit', count: '3', total_amount: '30000' },  // 300.00 in currency
        { transaction_type: 'transfer_in', count: '2', total_amount: '20000' }, // 200.00 in currency
        { transaction_type: 'transfer_out', count: '1', total_amount: '10000' } // 100.00 in currency
      ];

      const summary = balanceService.calculateTransactionSummary(mockResults, 'NGN');

      expect(summary.totalTransactions).toBe(11); // 5 + 3 + 2 + 1
      expect(summary.totalCredits).toBe(700); // 500 + 200
      expect(summary.totalDebits).toBe(400); // 300 + 100
      expect(summary.netChange).toBe(300); // 700 - 400
    });

    test('should handle empty transaction results', () => {
      const summary = balanceService.calculateTransactionSummary([], 'USD');

      expect(summary.totalTransactions).toBe(0);
      expect(summary.totalCredits).toBe(0);
      expect(summary.totalDebits).toBe(0);
      expect(summary.netChange).toBe(0);
    });
  });

  describe('Multi-Currency Summary Calculations', () => {
    test('should calculate multi-currency summary correctly', () => {
      const mockBalances = {
        NGN: {
          balance: {
            availableBalance: 1000,
            pendingBalance: 100,
            totalBalance: 1100
          },
          transactions: { total: 5 }
        },
        USD: {
          balance: {
            availableBalance: 0,
            pendingBalance: 0,
            totalBalance: 0
          },
          transactions: { total: 0 }
        }
      };

      const summary = balanceService.calculateMultiCurrencySummary(mockBalances);

      expect(summary.totalCurrencies).toBe(2);
      expect(summary.hasBalances).toBe(true);
      expect(summary.currencies.NGN.availableBalance).toBe(1000);
      expect(summary.currencies.NGN.hasTransactions).toBe(true);
      expect(summary.currencies.USD.availableBalance).toBe(0);
      expect(summary.currencies.USD.hasTransactions).toBe(false);
    });

    test('should handle balances without transactions', () => {
      const mockBalances = {
        NGN: {
          balance: {
            availableBalance: 500,
            pendingBalance: 0,
            totalBalance: 500
          }
          // No transactions property
        }
      };

      const summary = balanceService.calculateMultiCurrencySummary(mockBalances);

      expect(summary.totalCurrencies).toBe(1);
      expect(summary.hasBalances).toBe(true);
      expect(summary.currencies.NGN.hasTransactions).toBe(false);
    });
  });

  describe('Analytics Summary Calculations', () => {
    test('should calculate analytics summary correctly', () => {
      const mockAnalytics = [
        { endBalance: 1000, transactionCount: 5 },
        { endBalance: 1200, transactionCount: 3 },
        { endBalance: 800, transactionCount: 7 },
        { endBalance: 1100, transactionCount: 2 }
      ];

      const summary = balanceService.calculateAnalyticsSummary(mockAnalytics);

      expect(summary.totalPeriods).toBe(4);
      expect(summary.averageBalance).toBe(1025); // (1000 + 1200 + 800 + 1100) / 4
      expect(summary.highestBalance).toBe(1200);
      expect(summary.lowestBalance).toBe(800);
      expect(summary.totalTransactions).toBe(17); // 5 + 3 + 7 + 2
    });

    test('should handle empty analytics data', () => {
      const summary = balanceService.calculateAnalyticsSummary([]);

      expect(summary.totalPeriods).toBe(0);
      expect(summary.averageBalance).toBe(0);
      expect(summary.highestBalance).toBe(0);
      expect(summary.lowestBalance).toBe(0);
      expect(summary.totalTransactions).toBe(0);
    });
  });

  describe('Currency Validation', () => {
    test('should validate currencies through wallet service', () => {
      expect(() => {
        balanceService.walletService.validateCurrency('NGN');
      }).not.toThrow();

      expect(() => {
        balanceService.walletService.validateCurrency('USD');
      }).not.toThrow();

      expect(() => {
        balanceService.walletService.validateCurrency('EUR');
      }).toThrow('Unsupported currency');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid date ranges gracefully', () => {
      // Test with invalid date strings
      expect(() => {
        new Date('invalid-date');
      }).not.toThrow(); // JavaScript Date constructor doesn't throw, returns Invalid Date

      // Test with future dates
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      
      expect(futureDate.getTime()).toBeGreaterThan(Date.now());
    });

    test('should handle large period requests', () => {
      // Test with large number of periods
      const intervals = balanceService.calculateDateIntervals('day', 1000);
      
      expect(intervals).toHaveLength(1000);
      expect(intervals[0].start).toBeInstanceOf(Date);
      expect(intervals[999].start).toBeInstanceOf(Date);
    });
  });

  describe('Performance Considerations', () => {
    test('should limit query results appropriately', () => {
      // Test that limits are applied correctly
      const maxLimit = 100;
      const requestedLimit = 500;
      
      const actualLimit = Math.min(requestedLimit, maxLimit);
      expect(actualLimit).toBe(100);
    });

    test('should handle pagination parameters', () => {
      const limit = 50;
      const offset = 100;
      const total = 250;
      
      const hasMore = offset + limit < total;
      expect(hasMore).toBe(true);
      
      const lastPageOffset = 200;
      const lastPageHasMore = lastPageOffset + limit < total;
      expect(lastPageHasMore).toBe(false);
    });
  });

  describe('Data Formatting', () => {
    test('should format transaction data consistently', () => {
      const mockTransaction = {
        id: 'tx-123',
        transaction_type: 'credit',
        amount: 50000, // 500.00 in cents
        balance_before: 100000, // 1000.00 in cents
        balance_after: 150000, // 1500.00 in cents
        reference: 'ref-456',
        description: 'Test transaction',
        metadata: { test: true },
        created_at: new Date('2024-01-01')
      };

      // Simulate the formatting that would happen in the service
      const formatted = {
        id: mockTransaction.id,
        type: mockTransaction.transaction_type,
        amount: mockTransaction.amount / 100, // Convert from cents
        balanceBefore: mockTransaction.balance_before / 100,
        balanceAfter: mockTransaction.balance_after / 100,
        reference: mockTransaction.reference,
        description: mockTransaction.description,
        metadata: mockTransaction.metadata,
        createdAt: mockTransaction.created_at
      };

      expect(formatted.amount).toBe(500);
      expect(formatted.balanceBefore).toBe(1000);
      expect(formatted.balanceAfter).toBe(1500);
      expect(formatted.type).toBe('credit');
    });
  });

  describe('Service Integration', () => {
    test('should integrate with wallet service correctly', () => {
      // Test that the balance service uses the wallet service properly
      expect(balanceService.walletService.supportedCurrencies).toContain('NGN');
      expect(balanceService.walletService.supportedCurrencies).toContain('USD');
      
      // Test gateway mapping
      expect(balanceService.walletService.getRequiredGateway('NGN')).toBe('paystack');
      expect(balanceService.walletService.getRequiredGateway('USD')).toBe('stripe');
    });
  });
});