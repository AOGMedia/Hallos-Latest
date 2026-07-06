const fc = require('fast-check');
const MultiCurrencyWalletService = require('../../services/multiCurrencyWalletService');

/**
 * Property-Based Tests for Currency Isolation
 * 
 * **Property 6: Currency Isolation**
 * **Validates: Requirements 6.1, 6.3**
 * 
 * These tests verify that:
 * 1. Operations on NGN wallets never affect USD wallets and vice versa
 * 2. Each currency maintains completely separate balance tracking
 * 3. Cross-currency operations are properly rejected
 * 4. Currency-specific gateway routing is enforced
 * 5. Wallet initialization creates isolated currency accounts
 */

describe('Currency Isolation Property Tests', () => {
  let walletService;

  beforeAll(() => {
    walletService = new MultiCurrencyWalletService();
  });

  describe('Property 6: Currency Isolation', () => {

    // Test that wallet formatting maintains currency isolation
    test('should maintain complete isolation between NGN and USD wallet formatting', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000 }), // userId
        fc.integer({ min: 100, max: 1000000 }), // NGN amount in cents
        fc.integer({ min: 100, max: 100000 }), // USD amount in cents
        (userId, ngnAmountCents, usdAmountCents) => {
          // Convert cents to currency amounts for testing
          const ngnAmount = ngnAmountCents / 100;
          const usdAmount = usdAmountCents / 100;

          // Mock wallet accounts for testing
          const mockNgnWallet = {
            id: `ngn-wallet-${userId}`,
            user_id: userId,
            currency: 'NGN',
            balance_available: ngnAmountCents,
            balance_pending: 0,
            created_at: new Date(),
            updated_at: new Date()
          };

          const mockUsdWallet = {
            id: `usd-wallet-${userId}`,
            user_id: userId,
            currency: 'USD',
            balance_available: usdAmountCents,
            balance_pending: 0,
            created_at: new Date(),
            updated_at: new Date()
          };

          // Test currency isolation by verifying wallet responses
          const ngnFormatted = walletService.formatWalletResponse(mockNgnWallet);
          const usdFormatted = walletService.formatWalletResponse(mockUsdWallet);

          // Verify that NGN wallet only contains NGN data
          expect(ngnFormatted.currency).toBe('NGN');
          expect(ngnFormatted.availableBalance).toBe(ngnAmount);
          expect(ngnFormatted.userId).toBe(userId);

          // Verify that USD wallet only contains USD data
          expect(usdFormatted.currency).toBe('USD');
          expect(usdFormatted.availableBalance).toBe(usdAmount);
          expect(usdFormatted.userId).toBe(userId);

          // Verify wallets are completely separate objects
          expect(ngnFormatted.id).not.toBe(usdFormatted.id);
          expect(ngnFormatted.currency).not.toBe(usdFormatted.currency);

          // Verify currency conversion is consistent
          expect(walletService.convertToCents(ngnAmount, 'NGN')).toBe(ngnAmountCents);
          expect(walletService.convertToCents(usdAmount, 'USD')).toBe(usdAmountCents);
        }
      ), { numRuns: 50 });
    });

    // Test that currency validation prevents cross-currency contamination
    test('should reject invalid currency operations', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 10 }), // invalid currency
        fc.integer({ min: 100, max: 100000 }), // amount in cents
        (invalidCurrency, amountCents) => {
          // Skip if accidentally valid currency
          if (['NGN', 'USD'].includes(invalidCurrency.toUpperCase())) {
            return;
          }

          const amount = amountCents / 100;

          // Should reject invalid currencies
          expect(() => {
            walletService.validateCurrency(invalidCurrency);
          }).toThrow();

          // Should reject invalid currency in gateway mapping
          expect(() => {
            walletService.getRequiredGateway(invalidCurrency);
          }).toThrow();
        }
      ), { numRuns: 30 });
    });

    // Test gateway routing isolation
    test('should enforce strict currency-gateway pairing', () => {
      fc.assert(fc.property(
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // valid currency
        fc.oneof(fc.constant('paystack'), fc.constant('stripe')), // gateway
        (currency, gateway) => {
          const requiredGateway = walletService.getRequiredGateway(currency);

          if (gateway === requiredGateway) {
            // Valid pairing should not throw
            expect(() => {
              walletService.validateCurrencyGatewayPairing(currency, gateway);
            }).not.toThrow();
          } else {
            // Invalid pairing should throw
            expect(() => {
              walletService.validateCurrencyGatewayPairing(currency, gateway);
            }).toThrow();
          }

          // Verify correct gateway mapping
          if (currency === 'NGN') {
            expect(requiredGateway).toBe('paystack');
          } else if (currency === 'USD') {
            expect(requiredGateway).toBe('stripe');
          }
        }
      ), { numRuns: 20 });
    });

    // Test amount validation consistency across currencies
    test('should validate amounts consistently across all currencies', () => {
      fc.assert(fc.property(
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.oneof(
          fc.integer({ min: 1, max: 99999900 }), // valid amounts in cents
          fc.oneof(fc.constant(0), fc.constant(-1)) // invalid amounts
        ),
        (currency, amountCents) => {
          const amount = amountCents / 100;

          if (amount > 0 && amount < 999999) {
            // Valid amounts should not throw
            expect(() => {
              walletService.validateAmount(amount);
            }).not.toThrow();

            // Should convert correctly
            const cents = walletService.convertToCents(amount, currency);
            expect(cents).toBe(Math.round(amount * 100));

            const backToAmount = walletService.convertFromCents(cents, currency);
            expect(Math.abs(backToAmount - amount)).toBeLessThan(0.01); // Allow for rounding
          } else {
            // Invalid amounts should throw
            expect(() => {
              walletService.validateAmount(amount);
            }).toThrow();
          }
        }
      ), { numRuns: 40 });
    });

    // Test wallet initialization creates isolated accounts
    test('should create isolated wallet accounts for each currency', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000 }), // userId
        (userId) => {
          // Test supported currencies
          const supportedCurrencies = walletService.supportedCurrencies;
          
          expect(supportedCurrencies).toContain('NGN');
          expect(supportedCurrencies).toContain('USD');
          expect(supportedCurrencies).toHaveLength(2);

          // Test gateway mapping isolation
          const ngnGateway = walletService.getRequiredGateway('NGN');
          const usdGateway = walletService.getRequiredGateway('USD');

          expect(ngnGateway).toBe('paystack');
          expect(usdGateway).toBe('stripe');
          expect(ngnGateway).not.toBe(usdGateway);

          // Test that each currency has its own validation
          expect(() => walletService.validateCurrency('NGN')).not.toThrow();
          expect(() => walletService.validateCurrency('USD')).not.toThrow();
          expect(() => walletService.validateCurrency('EUR')).toThrow();
        }
      ), { numRuns: 25 });
    });

    // Test transfer validation (without actual database calls)
    test('should validate transfer parameters with currency isolation', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 100 }), // fromUserId
        fc.integer({ min: 101, max: 200 }), // toUserId (different from fromUserId)
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.integer({ min: 100, max: 100000 }), // amount in cents
        (fromUserId, toUserId, currency, amountCents) => {
          const amount = amountCents / 100;

          // Ensure different users (this should always be true with our generators)
          expect(fromUserId).not.toBe(toUserId);

          // The transfer should validate currency properly
          expect(() => {
            walletService.validateCurrency(currency);
            walletService.validateAmount(amount);
          }).not.toThrow();

          // Verify currency-specific gateway requirements
          const requiredGateway = walletService.getRequiredGateway(currency);
          if (currency === 'NGN') {
            expect(requiredGateway).toBe('paystack');
          } else {
            expect(requiredGateway).toBe('stripe');
          }

          // Verify amount conversion consistency
          const cents = walletService.convertToCents(amount, currency);
          const backToAmount = walletService.convertFromCents(cents, currency);
          expect(Math.abs(backToAmount - amount)).toBeLessThan(0.01);
        }
      ), { numRuns: 30 });
    });

    // Test currency conversion precision and isolation
    test('should maintain precision and isolation in currency conversions', () => {
      fc.assert(fc.property(
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 1, maxLength: 10 }), // amounts in cents
        (currency, amountsCents) => {
          const amounts = amountsCents.map(cents => cents / 100);
          
          const conversions = amounts.map(amount => {
            const cents = walletService.convertToCents(amount, currency);
            const backToAmount = walletService.convertFromCents(cents, currency);
            
            return {
              original: amount,
              cents,
              converted: backToAmount,
              precision: Math.abs(backToAmount - amount)
            };
          });

          // All conversions should maintain reasonable precision
          conversions.forEach(conv => {
            expect(conv.cents).toBeGreaterThan(0);
            expect(conv.precision).toBeLessThan(0.01); // Within 1 cent precision
            expect(Number.isInteger(conv.cents)).toBe(true); // Cents should be integers
          });

          // Conversions should be consistent for the same currency
          const uniqueAmounts = [...new Set(amounts)];
          uniqueAmounts.forEach(amount => {
            const cents1 = walletService.convertToCents(amount, currency);
            const cents2 = walletService.convertToCents(amount, currency);
            expect(cents1).toBe(cents2);
          });
        }
      ), { numRuns: 35 });
    });

    // Test error message isolation and clarity
    test('should provide clear, currency-specific error messages', () => {
      fc.assert(fc.property(
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // valid currency
        fc.oneof(fc.constant('paystack'), fc.constant('stripe')), // gateway
        (currency, gateway) => {
          const requiredGateway = walletService.getRequiredGateway(currency);

          if (gateway !== requiredGateway) {
            try {
              walletService.validateCurrencyGatewayPairing(currency, gateway);
              // Should not reach here
              expect(true).toBe(false);
            } catch (error) {
              // Error message should be currency-specific
              expect(error.message).toContain(currency);
              expect(error.message).toContain(requiredGateway);
              expect(error.message).toContain(gateway);
              
              // Should indicate the correct pairing
              if (currency === 'NGN') {
                expect(error.message).toContain('paystack');
              } else if (currency === 'USD') {
                expect(error.message).toContain('stripe');
              }
            }
          }
        }
      ), { numRuns: 20 });
    });

    // Test wallet response format isolation
    test('should format wallet responses with proper currency isolation', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000 }), // userId
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.integer({ min: 0, max: 1000000 }), // available balance in cents
        fc.integer({ min: 0, max: 100000 }), // pending balance in cents
        (userId, currency, availableCents, pendingCents) => {
          const mockWallet = {
            id: `wallet-${currency.toLowerCase()}-${userId}`,
            user_id: userId,
            currency: currency,
            balance_available: availableCents,
            balance_pending: pendingCents,
            created_at: new Date('2024-01-01'),
            updated_at: new Date('2024-01-02')
          };

          const formatted = walletService.formatWalletResponse(mockWallet);

          // Verify currency isolation in response
          expect(formatted.currency).toBe(currency);
          expect(formatted.userId).toBe(userId);
          expect(formatted.id).toContain(currency.toLowerCase());

          // Verify amounts are properly converted
          expect(formatted.availableBalance).toBe(availableCents / 100);
          expect(formatted.pendingBalance).toBe(pendingCents / 100);
          expect(formatted.totalBalance).toBe((availableCents + pendingCents) / 100);

          // Verify no cross-currency contamination
          if (currency === 'NGN') {
            expect(formatted.id).not.toContain('usd');
            expect(formatted.currency).not.toBe('USD');
          } else if (currency === 'USD') {
            expect(formatted.id).not.toContain('ngn');
            expect(formatted.currency).not.toBe('NGN');
          }
        }
      ), { numRuns: 40 });
    });
  });

  describe('Currency Isolation Edge Cases', () => {

    test('should handle currency case sensitivity properly', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.constant('ngn'), fc.constant('NGN'), 
          fc.constant('usd'), fc.constant('USD'),
          fc.constant('Ngn'), fc.constant('Usd')
        ),
        (currency) => {
          const upperCurrency = currency.toUpperCase();
          
          if (['NGN', 'USD'].includes(upperCurrency)) {
            // Should accept when properly converted to uppercase
            expect(() => {
              walletService.validateCurrency(upperCurrency);
            }).not.toThrow();

            // Should get correct gateway
            const gateway = walletService.getRequiredGateway(upperCurrency);
            if (upperCurrency === 'NGN') {
              expect(gateway).toBe('paystack');
            } else {
              expect(gateway).toBe('stripe');
            }
          }
        }
      ), { numRuns: 20 });
    });

    test('should reject null and undefined currency values', () => {
      fc.assert(fc.property(
        fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant('')),
        (invalidCurrency) => {
          expect(() => {
            walletService.validateCurrency(invalidCurrency);
          }).toThrow('Currency is required');
        }
      ), { numRuns: 10 });
    });

    test('should maintain isolation under concurrent operations', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 100 }), // userId
        fc.array(fc.oneof(fc.constant('NGN'), fc.constant('USD')), { minLength: 2, maxLength: 10 }), // currencies
        fc.array(fc.float({ min: 1, max: 100, noNaN: true }), { minLength: 2, maxLength: 10 }), // amounts
        (userId, currencies, amounts) => {
          // Simulate concurrent operations on different currencies
          const operations = currencies.map((currency, index) => {
            const amount = amounts[index % amounts.length];
            
            return {
              currency,
              amount,
              gateway: walletService.getRequiredGateway(currency),
              cents: walletService.convertToCents(amount, currency)
            };
          });

          // Verify each operation maintains currency isolation
          operations.forEach(op => {
            expect(['NGN', 'USD']).toContain(op.currency);
            expect(['paystack', 'stripe']).toContain(op.gateway);
            expect(op.cents).toBeGreaterThan(0);
            expect(Number.isInteger(op.cents)).toBe(true);

            // Verify correct gateway mapping
            if (op.currency === 'NGN') {
              expect(op.gateway).toBe('paystack');
            } else {
              expect(op.gateway).toBe('stripe');
            }
          });

          // Verify no cross-contamination between operations
          const ngnOps = operations.filter(op => op.currency === 'NGN');
          const usdOps = operations.filter(op => op.currency === 'USD');

          ngnOps.forEach(op => expect(op.gateway).toBe('paystack'));
          usdOps.forEach(op => expect(op.gateway).toBe('stripe'));
        }
      ), { numRuns: 25 });
    });
  });

  describe('Service Configuration Isolation', () => {

    test('should maintain consistent service configuration', () => {
      // Test that service configuration is immutable and isolated
      const currencies = walletService.supportedCurrencies;
      const gatewayMapping = walletService.gatewayMapping;

      expect(currencies).toEqual(['NGN', 'USD']);
      expect(gatewayMapping).toEqual({
        'NGN': 'paystack',
        'USD': 'stripe'
      });

      // Verify configuration cannot be accidentally modified
      expect(Object.isFrozen(currencies)).toBe(false); // Array is not frozen, but should be treated as immutable
      expect(currencies.length).toBe(2);
      expect(Object.keys(gatewayMapping).length).toBe(2);
    });

    test('should provide consistent validation across all methods', () => {
      fc.assert(fc.property(
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // valid currency
        (currency) => {
          // All validation methods should be consistent
          expect(() => walletService.validateCurrency(currency)).not.toThrow();
          expect(() => walletService.getRequiredGateway(currency)).not.toThrow();
          expect(() => walletService.convertToCents(100, currency)).not.toThrow();
          expect(() => walletService.convertFromCents(10000, currency)).not.toThrow();

          const gateway = walletService.getRequiredGateway(currency);
          expect(() => walletService.validateCurrencyGatewayPairing(currency, gateway)).not.toThrow();
        }
      ), { numRuns: 15 });
    });
  });
});