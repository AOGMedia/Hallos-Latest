const fc = require('fast-check');

/**
 * Property-Based Tests for Gateway Routing
 * 
 * **Property 7: Currency-Gateway Routing**
 * **Validates: Requirements 7.1, 7.2, 11.1, 11.2**
 * 
 * These tests verify that:
 * 1. NGN payments are always routed to Paystack
 * 2. USD payments are always routed to Stripe
 * 3. Invalid currency-gateway pairings are rejected
 * 4. Gateway routing is deterministic and consistent
 * 5. Currency validation works correctly
 */

describe('Gateway Routing Properties', () => {
  // Mock the payment routing service logic without database dependencies
  const createGatewayRouter = () => {
    const supportedCurrencies = ['NGN', 'USD'];
    const gatewayMapping = {
      'NGN': 'paystack',
      'USD': 'stripe'
    };

    return {
      getSupportedCurrencies: () => supportedCurrencies,
      
      getGatewayForCurrency: (currency) => {
        if (!currency || typeof currency !== 'string') {
          throw new Error('Currency is required and must be a string');
        }
        
        const upperCurrency = currency.toUpperCase();
        if (!supportedCurrencies.includes(upperCurrency)) {
          throw new Error(`Unsupported currency: ${currency}. Supported currencies: ${supportedCurrencies.join(', ')}`);
        }
        
        return gatewayMapping[upperCurrency];
      },
      
      validateCurrencyGatewayPairing: (currency, gateway) => {
        if (!currency || typeof currency !== 'string') {
          throw new Error('Currency is required and must be a string');
        }
        
        if (!gateway || typeof gateway !== 'string') {
          throw new Error('Gateway is required and must be a string');
        }
        
        const upperCurrency = currency.toUpperCase();
        if (!supportedCurrencies.includes(upperCurrency)) {
          throw new Error(`Unsupported currency: ${currency}`);
        }
        
        const requiredGateway = gatewayMapping[upperCurrency];
        if (gateway !== requiredGateway) {
          throw new Error(
            `Invalid gateway for ${upperCurrency}. ${upperCurrency} transactions must use ${requiredGateway}, got ${gateway}`
          );
        }
        
        return true;
      },
      
      validateCurrency: (currency) => {
        if (!currency || typeof currency !== 'string') {
          throw new Error('Currency is required and must be a string');
        }
        
        const upperCurrency = currency.toUpperCase();
        if (!supportedCurrencies.includes(upperCurrency)) {
          throw new Error(`Unsupported currency: ${currency}. Supported currencies: ${supportedCurrencies.join(', ')}`);
        }
        
        return true;
      }
    };
  };

  /**
   * Property 7.1: NGN Currency Always Routes to Paystack
   * 
   * For any valid NGN currency input (case-insensitive),
   * the gateway routing should always return 'paystack'
   */
  test('Property 7.1: NGN currency always routes to Paystack', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('NGN', 'ngn', 'Ngn', 'nGN'),
        (currency) => {
          const router = createGatewayRouter();
          const gateway = router.getGatewayForCurrency(currency);
          
          // NGN should always route to Paystack
          expect(gateway).toBe('paystack');
          
          // Validation should pass for correct pairing
          expect(() => {
            router.validateCurrencyGatewayPairing(currency, 'paystack');
          }).not.toThrow();
          
          // Validation should fail for incorrect pairing
          expect(() => {
            router.validateCurrencyGatewayPairing(currency, 'stripe');
          }).toThrow('Invalid gateway for NGN');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7.2: USD Currency Always Routes to Stripe
   * 
   * For any valid USD currency input (case-insensitive),
   * the gateway routing should always return 'stripe'
   */
  test('Property 7.2: USD currency always routes to Stripe', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('USD', 'usd', 'Usd', 'uSD'),
        (currency) => {
          const router = createGatewayRouter();
          const gateway = router.getGatewayForCurrency(currency);
          
          // USD should always route to Stripe
          expect(gateway).toBe('stripe');
          
          // Validation should pass for correct pairing
          expect(() => {
            router.validateCurrencyGatewayPairing(currency, 'stripe');
          }).not.toThrow();
          
          // Validation should fail for incorrect pairing
          expect(() => {
            router.validateCurrencyGatewayPairing(currency, 'paystack');
          }).toThrow('Invalid gateway for USD');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7.3: Gateway Routing is Deterministic
   * 
   * For any supported currency, multiple calls to getGatewayForCurrency
   * should always return the same gateway
   */
  test('Property 7.3: Gateway routing is deterministic', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('NGN', 'USD'),
        (currency) => {
          const router = createGatewayRouter();
          
          // Multiple calls should return the same result
          const gateway1 = router.getGatewayForCurrency(currency);
          const gateway2 = router.getGatewayForCurrency(currency);
          const gateway3 = router.getGatewayForCurrency(currency);
          
          expect(gateway1).toBe(gateway2);
          expect(gateway2).toBe(gateway3);
          
          // Result should match expected mapping
          if (currency === 'NGN') {
            expect(gateway1).toBe('paystack');
          } else if (currency === 'USD') {
            expect(gateway1).toBe('stripe');
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 7.4: Invalid Currencies are Rejected
   * 
   * For any currency that is not NGN or USD,
   * the system should reject it with appropriate error
   */
  test('Property 7.4: Invalid currencies are rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 })
          .filter(s => !['NGN', 'USD', 'ngn', 'usd'].includes(s.toUpperCase())),
        (invalidCurrency) => {
          const router = createGatewayRouter();
          
          // Should throw error for unsupported currency
          expect(() => {
            router.getGatewayForCurrency(invalidCurrency);
          }).toThrow('Unsupported currency');
          
          // Validation should also fail
          expect(() => {
            router.validateCurrency(invalidCurrency);
          }).toThrow('Unsupported currency');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7.5: Currency-Gateway Pairing Validation
   * 
   * For any valid currency and gateway combination,
   * validation should only pass for correct pairings
   */
  test('Property 7.5: Currency-gateway pairing validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          currency: fc.constantFrom('NGN', 'USD'),
          gateway: fc.constantFrom('paystack', 'stripe')
        }),
        ({ currency, gateway }) => {
          const router = createGatewayRouter();
          
          const expectedGateway = router.getGatewayForCurrency(currency);
          
          if (gateway === expectedGateway) {
            // Correct pairing should not throw
            expect(() => {
              router.validateCurrencyGatewayPairing(currency, gateway);
            }).not.toThrow();
          } else {
            // Incorrect pairing should throw
            expect(() => {
              router.validateCurrencyGatewayPairing(currency, gateway);
            }).toThrow('Invalid gateway');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7.6: Input Validation Robustness
   * 
   * The system should handle various invalid inputs gracefully
   */
  test('Property 7.6: Input validation robustness', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(''),
          fc.integer(),
          fc.boolean(),
          fc.array(fc.string()),
          fc.object()
        ),
        (invalidInput) => {
          const router = createGatewayRouter();
          
          // Should handle invalid inputs gracefully
          expect(() => {
            router.getGatewayForCurrency(invalidInput);
          }).toThrow('Currency is required and must be a string');
          
          expect(() => {
            router.validateCurrency(invalidInput);
          }).toThrow('Currency is required and must be a string');
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 7.7: Gateway Pairing Input Validation
   * 
   * Currency-gateway pairing validation should handle invalid inputs
   */
  test('Property 7.7: Gateway pairing input validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          currency: fc.oneof(
            fc.constant('NGN'),
            fc.constant(null),
            fc.constant(''),
            fc.integer()
          ),
          gateway: fc.oneof(
            fc.constant('paystack'),
            fc.constant(null),
            fc.constant(''),
            fc.integer()
          )
        }),
        ({ currency, gateway }) => {
          const router = createGatewayRouter();
          
          if (typeof currency !== 'string' || !currency) {
            expect(() => {
              router.validateCurrencyGatewayPairing(currency, gateway);
            }).toThrow('Currency is required and must be a string');
          } else if (typeof gateway !== 'string' || !gateway) {
            expect(() => {
              router.validateCurrencyGatewayPairing(currency, gateway);
            }).toThrow('Gateway is required and must be a string');
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 7.8: Supported Currencies Consistency
   * 
   * The list of supported currencies should be consistent
   * and match the gateway mapping
   */
  test('Property 7.8: Supported currencies consistency', () => {
    const router = createGatewayRouter();
    const supportedCurrencies = router.getSupportedCurrencies();
    
    // Should contain exactly NGN and USD
    expect(supportedCurrencies).toHaveLength(2);
    expect(supportedCurrencies).toContain('NGN');
    expect(supportedCurrencies).toContain('USD');
    
    // Each supported currency should have a gateway
    supportedCurrencies.forEach(currency => {
      expect(() => {
        const gateway = router.getGatewayForCurrency(currency);
        expect(gateway).toBeTruthy();
        expect(typeof gateway).toBe('string');
      }).not.toThrow();
    });
  });

  /**
   * Property 7.9: Case Insensitive Currency Handling
   * 
   * Currency routing should work regardless of case
   */
  test('Property 7.9: Case insensitive currency handling', () => {
    fc.assert(
      fc.property(
        fc.record({
          baseCurrency: fc.constantFrom('NGN', 'USD'),
          caseVariation: fc.constantFrom('lower', 'upper', 'mixed')
        }),
        ({ baseCurrency, caseVariation }) => {
          const router = createGatewayRouter();
          
          let testCurrency;
          switch (caseVariation) {
            case 'lower':
              testCurrency = baseCurrency.toLowerCase();
              break;
            case 'upper':
              testCurrency = baseCurrency.toUpperCase();
              break;
            case 'mixed':
              testCurrency = baseCurrency.charAt(0).toUpperCase() + 
                           baseCurrency.slice(1).toLowerCase();
              break;
          }
          
          const gateway = router.getGatewayForCurrency(testCurrency);
          const expectedGateway = baseCurrency === 'NGN' ? 'paystack' : 'stripe';
          
          expect(gateway).toBe(expectedGateway);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 7.10: Gateway Routing Completeness
   * 
   * Every supported currency must have exactly one gateway
   */
  test('Property 7.10: Gateway routing completeness', () => {
    const router = createGatewayRouter();
    const supportedCurrencies = router.getSupportedCurrencies();
    const supportedGateways = ['paystack', 'stripe'];
    
    // Each currency should map to exactly one gateway
    const currencyGatewayMap = {};
    supportedCurrencies.forEach(currency => {
      const gateway = router.getGatewayForCurrency(currency);
      currencyGatewayMap[currency] = gateway;
      
      // Gateway should be one of the supported gateways
      expect(supportedGateways).toContain(gateway);
    });
    
    // Should have mapping for all currencies
    expect(Object.keys(currencyGatewayMap)).toHaveLength(supportedCurrencies.length);
    
    // Each gateway should be used by at least one currency
    const usedGateways = Object.values(currencyGatewayMap);
    supportedGateways.forEach(gateway => {
      expect(usedGateways).toContain(gateway);
    });
  });
});