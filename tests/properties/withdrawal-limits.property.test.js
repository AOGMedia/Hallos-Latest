const fc = require('fast-check');
const WithdrawalLimitService = require('../../services/withdrawalLimitService');

/**
 * Property-Based Tests for Withdrawal Limit Service
 * 
 * **Property 8: Withdrawal Limits Enforcement**
 * **Validates: Requirements 8.1, 8.2**
 * 
 * These tests verify that withdrawal limits are correctly enforced
 * across different scenarios and edge cases using property-based testing.
 */

describe('Withdrawal Limits Property Tests', () => {
  let withdrawalLimitService;

  beforeEach(() => {
    withdrawalLimitService = new WithdrawalLimitService();
  });

  describe('Property 8: Withdrawal Limits Enforcement', () => {
    /**
     * Property: Daily limits are never exceeded
     * For any sequence of withdrawals within a day, the total should never exceed daily limit
     */
    test('should never allow daily limit to be exceeded', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), // userId
          fc.constantFrom('NGN', 'USD'), // currency
          fc.array(
            fc.record({
              amount: fc.float({ min: 1, max: 5000, noNaN: true }),
              timestamp: fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 }) // within same day
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (userId, currency, withdrawals) => {
            // Get user limits
            const limits = await withdrawalLimitService.getUserLimits(userId, currency);
            
            let totalWithdrawn = 0;
            const baseTimestamp = Date.now();
            
            for (const withdrawal of withdrawals) {
              const withdrawalTimestamp = baseTimestamp + withdrawal.timestamp;
              
              // Check if withdrawal would be allowed
              const limitCheck = await withdrawalLimitService.checkWithdrawalLimits(
                userId,
                withdrawal.amount,
                currency
              );
              
              if (limitCheck.allowed) {
                // If allowed, record the withdrawal
                await withdrawalLimitService.recordWithdrawal(
                  userId,
                  withdrawal.amount,
                  currency,
                  `test_${withdrawalTimestamp}`
                );
                totalWithdrawn += withdrawal.amount;
                
                // Verify total doesn't exceed daily limit
                expect(totalWithdrawn).toBeLessThanOrEqual(limits.daily + 0.01); // Small epsilon for floating point
              } else {
                // If not allowed, verify it would have exceeded the limit
                expect(totalWithdrawn + withdrawal.amount).toBeGreaterThan(limits.daily);
              }
            }
          }
        ),
        { numRuns: 10, timeout: 5000 }
      );
    });

    /**
     * Property: Single transaction limits are enforced
     * No single withdrawal should exceed the single transaction limit
     */
    test('should never allow single transaction limit to be exceeded', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), // userId
          fc.constantFrom('NGN', 'USD'), // currency
          fc.float({ min: 1, max: 50000, noNaN: true }), // amount
          async (userId, currency, amount) => {
            const limits = await withdrawalLimitService.getUserLimits(userId, currency);
            
            const limitCheck = await withdrawalLimitService.checkWithdrawalLimits(
              userId,
              amount,
              currency
            );
            
            if (amount > limits.single) {
              // Should be rejected for single transaction limit
              expect(limitCheck.allowed).toBe(false);
              expect(limitCheck.type).toBe('single_limit');
            } else if (amount <= limits.daily && amount <= limits.monthly) {
              // Should be allowed if within all limits
              expect(limitCheck.allowed).toBe(true);
            }
          }
        ),
        { numRuns: 20, timeout: 3000 }
      );
    });

    /**
     * Property: User tier affects limits correctly
     * Different user tiers should have different limits
     */
    test('should apply correct limits based on user tier', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 50 }), // userId
          fc.constantFrom('default', 'vip', 'business'), // tier
          fc.constantFrom('NGN', 'USD'), // currency
          async (userId, tier, currency) => {
            // Set user tier
            withdrawalLimitService.setUserTier(userId, tier);
            
            // Get limits for this tier
            const limits = await withdrawalLimitService.getUserLimits(userId, currency);
            
            // Verify limits match expected tier
            const expectedLimits = withdrawalLimitService.config[`${tier}Limits`][currency];
            
            expect(limits.daily).toBe(expectedLimits.daily);
            expect(limits.monthly).toBe(expectedLimits.monthly);
            expect(limits.single).toBe(expectedLimits.single);
            
            // Verify tier is correctly stored
            expect(withdrawalLimitService.getUserTier(userId)).toBe(tier);
          }
        ),
        { numRuns: 15, timeout: 3000 }
      );
    });

    /**
     * Property: Suspended users cannot withdraw
     * Suspended users should always be denied withdrawals
     */
    test('should deny all withdrawals for suspended users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 50 }), // userId
          fc.constantFrom('NGN', 'USD'), // currency
          fc.float({ min: 1, max: 5000, noNaN: true }), // amount
          async (userId, currency, amount) => {
            // Suspend user
            withdrawalLimitService.suspendUser(userId, 'Test suspension');
            
            // Try to withdraw
            const limitCheck = await withdrawalLimitService.checkWithdrawalLimits(
              userId,
              amount,
              currency
            );
            
            // Should always be denied
            expect(limitCheck.allowed).toBe(false);
            expect(limitCheck.type).toBe('suspended');
          }
        ),
        { numRuns: 15, timeout: 3000 }
      );
    });

    /**
     * Property: Usage tracking is accurate
     * Recorded withdrawals should accurately update usage counters
     */
    test('should accurately track withdrawal usage', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 50 }), // userId
          fc.constantFrom('NGN', 'USD'), // currency
          fc.array(
            fc.float({ min: 100, max: 1000, noNaN: true }),
            { minLength: 1, maxLength: 5 }
          ),
          async (userId, currency, amounts) => {
            let expectedTotal = 0;
            
            for (let i = 0; i < amounts.length; i++) {
              const amount = amounts[i];
              
              // Record withdrawal
              await withdrawalLimitService.recordWithdrawal(
                userId,
                amount,
                currency,
                `usage_test_${i}`
              );
              
              expectedTotal += amount;
              
              // Check usage
              const usage = await withdrawalLimitService.getCurrentUsage(userId, currency);
              
              // Verify daily usage is accurate (within small epsilon for floating point)
              expect(Math.abs(usage.daily - expectedTotal)).toBeLessThan(0.01);
              expect(usage.dailyCount).toBe(i + 1);
            }
          }
        ),
        { numRuns: 15, timeout: 5000 }
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    /**
     * Test zero and negative amounts
     */
    test('should handle zero and negative amounts correctly', async () => {
      const userId = 1;
      const currency = 'NGN';
      
      // Zero amount
      const zeroCheck = await withdrawalLimitService.checkWithdrawalLimits(userId, 0, currency);
      expect(zeroCheck.allowed).toBe(true); // Zero amounts are typically allowed
      
      // Negative amount
      const negativeCheck = await withdrawalLimitService.checkWithdrawalLimits(userId, -100, currency);
      expect(negativeCheck.allowed).toBe(false);
    });

    /**
     * Test invalid currency handling
     */
    test('should handle invalid currencies gracefully', async () => {
      const userId = 1;
      
      // Should fall back to default limits or handle gracefully
      const limitCheck = await withdrawalLimitService.checkWithdrawalLimits(userId, 1000, 'INVALID');
      expect(limitCheck).toBeDefined();
      expect(typeof limitCheck.allowed).toBe('boolean');
    });
  });
});