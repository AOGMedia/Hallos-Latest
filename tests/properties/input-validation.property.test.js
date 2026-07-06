const fc = require('fast-check');
const validationMiddleware = require('../../middleware/inputValidationMiddleware');

/**
 * Property-Based Tests for Input Validation Middleware
 * 
 * **Property 3: Input Validation Completeness**
 * **Validates: Requirements 3.1, 3.4**
 * 
 * These tests verify that:
 * 1. All invalid inputs are rejected with appropriate validation errors
 * 2. Amount limits are enforced per currency
 * 3. Currency validation works correctly
 * 4. Sanitization prevents injection attacks
 */

describe('Input Validation Property Tests', () => {
  
  describe('Property 3: Input Validation Completeness', () => {
    
    // Test that invalid amounts are always rejected
    test('should reject invalid amounts for any currency', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.constant('NGN'),
          fc.constant('USD')
        ),
        fc.oneof(
          fc.double({ min: -1000000, max: 0 }), // Negative amounts
          fc.constant(0), // Zero amounts
          fc.double({ min: 0.001, max: 0.009 }), // Too small amounts
          fc.double({ min: 1000000, max: Number.MAX_SAFE_INTEGER }), // Too large amounts
          fc.constant(NaN), // Invalid numbers
          fc.constant(Infinity),
          fc.constant(-Infinity)
        ),
        (currency, invalidAmount) => {
          const mockReq = {
            body: {
              amount: invalidAmount,
              currency: currency,
              contentId: '550e8400-e29b-41d4-a716-446655440000',
              buyerId: '550e8400-e29b-41d4-a716-446655440001',
              creatorId: '550e8400-e29b-41d4-a716-446655440002',
              idempotencyKey: '550e8400-e29b-41d4-a716-446655440003'
            }
          };
          
          const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          
          const mockNext = jest.fn();
          
          // Apply payment request validation
          validationMiddleware.validatePaymentRequest(mockReq, mockRes, mockNext);
          
          // Should reject invalid amounts
          expect(mockRes.status).toHaveBeenCalledWith(400);
          expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
              error: expect.objectContaining({
                code: 'VALIDATION_ERROR'
              })
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
        }
      ), { numRuns: 50 });
    });
    
    // Test that invalid currencies are always rejected
    test('should reject invalid currencies', () => {
      fc.assert(fc.property(
        fc.string().filter(s => !['NGN', 'USD'].includes(s)), // Invalid currencies
        fc.double({ min: 1, max: 1000 }), // Valid amount
        (invalidCurrency, validAmount) => {
          const mockReq = {
            body: {
              amount: validAmount,
              currency: invalidCurrency,
              contentId: '550e8400-e29b-41d4-a716-446655440000',
              buyerId: '550e8400-e29b-41d4-a716-446655440001',
              creatorId: '550e8400-e29b-41d4-a716-446655440002',
              idempotencyKey: '550e8400-e29b-41d4-a716-446655440003'
            }
          };
          
          const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          
          const mockNext = jest.fn();
          
          validationMiddleware.validatePaymentRequest(mockReq, mockRes, mockNext);
          
          // Should reject invalid currencies
          expect(mockRes.status).toHaveBeenCalledWith(400);
          expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
              error: expect.objectContaining({
                code: 'VALIDATION_ERROR'
              })
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
        }
      ), { numRuns: 30 });
    });
    
    // Test currency-specific amount limits
    test('should enforce currency-specific amount limits', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.record({
            currency: fc.constant('NGN'),
            amount: fc.oneof(
              fc.double({ min: 0.01, max: 0.99 }), // Below NGN minimum (₦1.00)
              fc.double({ min: 500001, max: 1000000 }) // Above NGN maximum (₦500,000)
            )
          }),
          fc.record({
            currency: fc.constant('USD'),
            amount: fc.oneof(
              fc.double({ min: 0.01, max: 0.99 }), // Below USD minimum ($1.00)
              fc.double({ min: 100001, max: 200000 }) // Above USD maximum ($100,000)
            )
          })
        ),
        ({ currency, amount }) => {
          const mockReq = {
            body: {
              amount: amount,
              currency: currency,
              contentId: '550e8400-e29b-41d4-a716-446655440000',
              buyerId: '550e8400-e29b-41d4-a716-446655440001',
              creatorId: '550e8400-e29b-41d4-a716-446655440002',
              idempotencyKey: '550e8400-e29b-41d4-a716-446655440003'
            }
          };
          
          const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          
          const mockNext = jest.fn();
          
          validationMiddleware.validatePaymentRequest(mockReq, mockRes, mockNext);
          
          // Should reject amounts outside currency limits
          expect(mockRes.status).toHaveBeenCalledWith(400);
          expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
              error: expect.objectContaining({
                code: 'VALIDATION_ERROR'
              })
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
        }
      ), { numRuns: 40 });
    });
    
    // Test that valid inputs always pass validation
    test('should accept valid payment requests', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.record({
            currency: fc.constant('NGN'),
            amount: fc.double({ min: 1, max: 500000, noNaN: true }) // Valid NGN range
          }),
          fc.record({
            currency: fc.constant('USD'),
            amount: fc.double({ min: 1, max: 100000, noNaN: true }) // Valid USD range
          })
        ),
        fc.uuid(4), // contentId
        fc.uuid(4), // buyerId
        fc.uuid(4), // creatorId
        fc.uuid(4), // idempotencyKey
        ({ currency, amount }, contentId, buyerId, creatorId, idempotencyKey) => {
          // Ensure amount is within valid range and properly formatted
          const validAmount = Math.max(1, Math.min(
            currency === 'NGN' ? 500000 : 100000,
            Math.round(amount * 100) / 100
          ));
          
          // Skip if amount is NaN or invalid
          if (!Number.isFinite(validAmount)) {
            return true; // Skip this test case
          }
          
          const mockReq = {
            body: {
              amount: validAmount,
              currency: currency,
              contentId: contentId,
              buyerId: buyerId,
              creatorId: creatorId,
              idempotencyKey: idempotencyKey
            }
          };
          
          const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          
          const mockNext = jest.fn();
          
          validationMiddleware.validatePaymentRequest(mockReq, mockRes, mockNext);
          
          // Should accept valid requests
          expect(mockNext).toHaveBeenCalled();
          expect(mockRes.status).not.toHaveBeenCalled();
          expect(mockRes.json).not.toHaveBeenCalled();
        }
      ), { numRuns: 50 });
    });
    
    // Test sanitization prevents injection attacks
    test('should sanitize malicious input strings', () => {
      fc.assert(fc.property(
        fc.oneof(
          fc.constant('<script>alert("xss")</script>'),
          fc.constant('javascript:alert("xss")'),
          fc.constant('<img src=x onerror=alert("xss")>'),
          fc.constant('"><script>alert("xss")</script>'),
          fc.constant("'; DROP TABLE users; --"),
          fc.constant('<iframe src="javascript:alert(\'xss\')"></iframe>')
        ),
        (maliciousString) => {
          const originalString = maliciousString;
          const sanitized = validationMiddleware.sanitizeString(maliciousString);
          
          // Sanitized string should not contain dangerous patterns
          expect(sanitized).not.toContain('<script>');
          expect(sanitized).not.toContain('javascript:');
          expect(sanitized).not.toContain('onerror=');
          expect(sanitized).not.toContain('<iframe');
          expect(sanitized).not.toContain('DROP TABLE');
          expect(sanitized).not.toContain('--');
          
          // Should be different from original if it contained malicious content
          if (originalString.includes('<') || originalString.includes('javascript:') || originalString.includes('script') || originalString.includes('DROP TABLE')) {
            expect(sanitized).not.toBe(originalString);
          }
        }
      ), { numRuns: 30 });
    });
    
    // Test withdrawal validation with bank details
    test('should validate withdrawal requests with currency-specific bank details', () => {
      fc.assert(fc.property(
        fc.oneof(
          // Valid NGN withdrawal
          fc.record({
            currency: fc.constant('NGN'),
            amount: fc.double({ min: 1, max: 500000, noNaN: true }),
            bankDetails: fc.record({
              accountNumber: fc.string({ minLength: 10, maxLength: 10 }).map(s => '1234567890'),
              bankCode: fc.string({ minLength: 3, maxLength: 3 }).map(s => '123'),
              accountName: fc.constant('John Doe Smith')
            })
          }),
          // Valid USD withdrawal
          fc.record({
            currency: fc.constant('USD'),
            amount: fc.double({ min: 1, max: 100000, noNaN: true }),
            bankDetails: fc.record({
              accountNumber: fc.constant('ABCD1234567890'),
              routingNumber: fc.constant('123456789'),
              accountHolderName: fc.constant('John Doe Smith'),
              bankName: fc.constant('Test Bank Name'),
              bankAddress: fc.constant('123 Main Street New York NY USA')
            })
          })
        ),
        fc.constant('123456'), // 2FA code
        fc.uuid(4), // idempotencyKey
        ({ currency, amount, bankDetails }, twoFactorCode, idempotencyKey) => {
          // Ensure amount is within valid range
          const validAmount = Math.max(1, Math.min(
            currency === 'NGN' ? 500000 : 100000,
            Math.round(amount * 100) / 100
          ));
          
          // Skip if amount is NaN or invalid
          if (!Number.isFinite(validAmount)) {
            return true; // Skip this test case
          }
          
          const mockReq = {
            body: {
              amount: validAmount,
              currency: currency,
              bankDetails: bankDetails,
              twoFactorCode: twoFactorCode,
              idempotencyKey: idempotencyKey
            }
          };
          
          const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          
          const mockNext = jest.fn();
          
          validationMiddleware.validateWithdrawalRequest(mockReq, mockRes, mockNext);
          
          // Should accept valid withdrawal requests
          expect(mockNext).toHaveBeenCalled();
          expect(mockRes.status).not.toHaveBeenCalled();
          expect(mockRes.json).not.toHaveBeenCalled();
        }
      ), { numRuns: 30 });
    });
    
    // Test that missing required fields are rejected
    test('should reject requests with missing required fields', () => {
      fc.assert(fc.property(
        fc.oneof(
          // Missing amount
          fc.record({
            currency: fc.constant('NGN'),
            contentId: fc.uuid(4),
            buyerId: fc.uuid(4),
            creatorId: fc.uuid(4),
            idempotencyKey: fc.uuid(4)
          }),
          // Missing currency
          fc.record({
            amount: fc.double({ min: 1, max: 1000 }),
            contentId: fc.uuid(4),
            buyerId: fc.uuid(4),
            creatorId: fc.uuid(4),
            idempotencyKey: fc.uuid(4)
          }),
          // Missing idempotencyKey
          fc.record({
            amount: fc.double({ min: 1, max: 1000 }),
            currency: fc.constant('USD'),
            contentId: fc.uuid(4),
            buyerId: fc.uuid(4),
            creatorId: fc.uuid(4)
          })
        ),
        (incompleteRequest) => {
          const mockReq = {
            body: incompleteRequest
          };
          
          const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          
          const mockNext = jest.fn();
          
          validationMiddleware.validatePaymentRequest(mockReq, mockRes, mockNext);
          
          // Should reject incomplete requests
          expect(mockRes.status).toHaveBeenCalledWith(400);
          expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
              error: expect.objectContaining({
                code: 'VALIDATION_ERROR'
              })
            })
          );
          expect(mockNext).not.toHaveBeenCalled();
        }
      ), { numRuns: 30 });
    });
    
    // Test transaction history query validation
    test('should validate transaction history queries correctly', () => {
      fc.assert(fc.property(
        fc.record({
          currency: fc.oneof(fc.constant('NGN'), fc.constant('USD'), fc.constant(undefined)),
          startDate: fc.oneof(
            fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
            fc.constant(undefined)
          ),
          endDate: fc.oneof(
            fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
            fc.constant(undefined)
          ),
          operationType: fc.oneof(
            fc.constant('credit'),
            fc.constant('debit'),
            fc.constant('payment'),
            fc.constant('withdrawal'),
            fc.constant('transfer'),
            fc.constant(undefined)
          ),
          limit: fc.oneof(fc.integer({ min: 1, max: 100 }), fc.constant(undefined)),
          offset: fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.constant(undefined))
        }),
        (queryParams) => {
          // Filter out undefined values
          const cleanQuery = Object.fromEntries(
            Object.entries(queryParams).filter(([_, value]) => value !== undefined)
          );
          
          // Convert dates to ISO strings if present and ensure valid date range
          if (cleanQuery.startDate) {
            // Skip invalid dates
            if (!cleanQuery.startDate.getTime || isNaN(cleanQuery.startDate.getTime())) {
              return true; // Skip this test case
            }
            cleanQuery.startDate = cleanQuery.startDate.toISOString().split('T')[0];
          }
          if (cleanQuery.endDate) {
            // Skip invalid dates
            if (!cleanQuery.endDate.getTime || isNaN(cleanQuery.endDate.getTime())) {
              return true; // Skip this test case
            }
            cleanQuery.endDate = cleanQuery.endDate.toISOString().split('T')[0];
          }
          
          // Ensure endDate is after startDate if both are present
          if (cleanQuery.startDate && cleanQuery.endDate && cleanQuery.endDate < cleanQuery.startDate) {
            // Swap dates to ensure valid range
            const temp = cleanQuery.startDate;
            cleanQuery.startDate = cleanQuery.endDate;
            cleanQuery.endDate = temp;
          }
          
          const mockReq = {
            query: cleanQuery
          };
          
          const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          
          const mockNext = jest.fn();
          
          validationMiddleware.validateTransactionHistory(mockReq, mockRes, mockNext);
          
          // Should accept valid query parameters
          expect(mockNext).toHaveBeenCalled();
          expect(mockRes.status).not.toHaveBeenCalled();
          expect(mockRes.json).not.toHaveBeenCalled();
        }
      ), { numRuns: 40 });
    });
  });
  
  describe('Sanitization Properties', () => {
    
    test('sanitization should be idempotent', () => {
      fc.assert(fc.property(
        fc.string(),
        (input) => {
          const sanitized1 = validationMiddleware.sanitizeString(input);
          const sanitized2 = validationMiddleware.sanitizeString(sanitized1);
          
          // Sanitizing twice should produce the same result
          expect(sanitized2).toBe(sanitized1);
        }
      ), { numRuns: 50 });
    });
    
    test('sanitization should preserve safe strings', () => {
      fc.assert(fc.property(
        fc.string().filter(s => 
          !s.includes('<') && 
          !s.includes('>') && 
          !s.toLowerCase().includes('javascript:') &&
          !s.toLowerCase().includes('script') &&
          !s.toLowerCase().includes('on') // Avoid event handlers
        ),
        (safeString) => {
          const sanitized = validationMiddleware.sanitizeString(safeString);
          
          // Safe strings should remain unchanged (except for trimming)
          expect(sanitized).toBe(safeString.trim());
        }
      ), { numRuns: 30 });
    });
  });
  
  describe('Amount Limit Properties', () => {
    
    test('amount limits should be consistent with currency specifications', () => {
      const { AMOUNT_LIMITS } = validationMiddleware;
      
      // NGN limits
      expect(AMOUNT_LIMITS.NGN.min).toBe(100); // ₦1.00 in kobo
      expect(AMOUNT_LIMITS.NGN.max).toBe(50000000); // ₦500,000 in kobo
      expect(AMOUNT_LIMITS.NGN.precision).toBe(2);
      
      // USD limits
      expect(AMOUNT_LIMITS.USD.min).toBe(100); // $1.00 in cents
      expect(AMOUNT_LIMITS.USD.max).toBe(10000000); // $100,000 in cents
      expect(AMOUNT_LIMITS.USD.precision).toBe(2);
    });
    
    test('supported currencies should only include NGN and USD', () => {
      const { SUPPORTED_CURRENCIES } = validationMiddleware;
      
      expect(SUPPORTED_CURRENCIES).toEqual(['NGN', 'USD']);
      expect(SUPPORTED_CURRENCIES).toHaveLength(2);
    });
  });
});