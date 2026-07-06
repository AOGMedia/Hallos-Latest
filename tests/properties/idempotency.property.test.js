const fc = require('fast-check');
const { idempotencyService, IdempotencyConflictError } = require('../../services/idempotencyService');
const sequelize = require('../../config/db');

/**
 * Property-Based Tests for Idempotency Manager
 * 
 * Feature: secure-multi-currency-wallet
 * Property 1: Idempotency Guarantee
 * 
 * Validates: Requirements 1.1, 1.2, 1.3
 */

describe('Idempotency Manager Property Tests', () => {
  
  beforeAll(async () => {
    // Ensure database connection
    await sequelize.authenticate();
  });
  
  afterAll(async () => {
    // Clean up test data
    await sequelize.query('DELETE FROM idempotency_keys WHERE operation_type LIKE \'test_%\'');
    await sequelize.close();
  });
  
  beforeEach(async () => {
    // Clean up before each test
    await sequelize.query('DELETE FROM idempotency_keys WHERE operation_type LIKE \'test_%\'');
  });

  /**
   * Property 1: Idempotency Guarantee
   * 
   * For any financial operation with an idempotency key, executing the operation 
   * multiple times should produce the same result as executing it once, with 
   * subsequent executions returning cached results and conflicting parameters 
   * being rejected.
   * 
   * Validates: Requirements 1.1, 1.2, 1.3
   */
  test('Property 1: Idempotency Guarantee - Multiple executions return same result', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate test data
        fc.uuid(),                    // idempotency key
        fc.integer({ min: 1, max: 1000 }), // user ID
        fc.constantFrom('test_withdrawal', 'test_payment', 'test_transfer'), // operation type
        fc.record({                   // operation data
          amount: fc.integer({ min: 100, max: 1000000 }),
          currency: fc.constantFrom('NGN', 'USD'),
          accountId: fc.uuid(),
          timestamp: fc.date().map(d => d.toISOString())
        }),
        fc.record({                   // operation result
          success: fc.boolean(),
          transactionId: fc.uuid(),
          amount: fc.integer({ min: 100, max: 1000000 }),
          timestamp: fc.date().map(d => d.toISOString())
        }),
        
        async (idempotencyKey, userId, operationType, operationData, operationResult) => {
          // First execution - should be new
          const firstCheck = await idempotencyService.checkAndStore(
            idempotencyKey, 
            userId, 
            operationType, 
            operationData
          );
          
          // Verify first execution is new
          expect(firstCheck.isNew).toBe(true);
          expect(firstCheck.lockAcquired).toBe(true);
          expect(firstCheck.status).toBe('processing');
          
          // Store the result
          await idempotencyService.storeResult(idempotencyKey, operationResult, 'completed');
          
          // Second execution - should return cached result
          const secondCheck = await idempotencyService.checkAndStore(
            idempotencyKey, 
            userId, 
            operationType, 
            operationData
          );
          
          // Verify second execution returns cached result
          expect(secondCheck.isNew).toBe(false);
          expect(secondCheck.lockAcquired).toBe(false);
          expect(secondCheck.status).toBe('completed');
          expect(secondCheck.storedResult).toEqual(operationResult);
          
          // Third execution - should also return same cached result
          const thirdCheck = await idempotencyService.checkAndStore(
            idempotencyKey, 
            userId, 
            operationType, 
            operationData
          );
          
          // Verify third execution returns same cached result
          expect(thirdCheck.isNew).toBe(false);
          expect(thirdCheck.storedResult).toEqual(operationResult);
          expect(thirdCheck.storedResult).toEqual(secondCheck.storedResult);
        }
      ),
      { 
        numRuns: 50, // Run 50 iterations for thorough testing
        timeout: 30000 // 30 second timeout
      }
    );
  });

  /**
   * Property 1b: Idempotency Conflict Detection
   * 
   * When the same idempotency key is used with different operation parameters,
   * the system should reject the request with a conflict error.
   * 
   * Validates: Requirement 1.3
   */
  test('Property 1b: Idempotency Conflict - Different parameters rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),                    // idempotency key
        fc.integer({ min: 1, max: 1000 }), // user ID
        fc.constantFrom('test_withdrawal', 'test_payment'), // operation type
        fc.record({                   // first operation data
          amount: fc.integer({ min: 100, max: 500000 }),
          currency: fc.constantFrom('NGN', 'USD'),
          accountId: fc.uuid()
        }),
        fc.record({                   // second operation data (different)
          amount: fc.integer({ min: 500001, max: 1000000 }), // Different amount range
          currency: fc.constantFrom('NGN', 'USD'),
          accountId: fc.uuid()
        }),
        
        async (idempotencyKey, userId, operationType, firstOperationData, secondOperationData) => {
          // Ensure the operation data is actually different
          fc.pre(!idempotencyService.operationsMatch(firstOperationData, secondOperationData));
          
          // First execution with first operation data
          const firstCheck = await idempotencyService.checkAndStore(
            idempotencyKey, 
            userId, 
            operationType, 
            firstOperationData
          );
          
          expect(firstCheck.isNew).toBe(true);
          
          // Second execution with different operation data should throw conflict
          await expect(
            idempotencyService.checkAndStore(
              idempotencyKey, 
              userId, 
              operationType, 
              secondOperationData
            )
          ).rejects.toThrow(IdempotencyConflictError);
        }
      ),
      { 
        numRuns: 30,
        timeout: 20000
      }
    );
  });

  /**
   * Property 1c: User Isolation
   * 
   * Idempotency keys should be isolated per user - the same key used by 
   * different users should not conflict.
   * 
   * Validates: Requirements 1.1, 1.2
   */
  test('Property 1c: User Isolation - Same key different users allowed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),                    // idempotency key
        fc.integer({ min: 1, max: 500 }),   // first user ID
        fc.integer({ min: 501, max: 1000 }), // second user ID (different range)
        fc.constantFrom('test_payment', 'test_transfer'), // operation type
        fc.record({                   // operation data
          amount: fc.integer({ min: 100, max: 1000000 }),
          currency: fc.constantFrom('NGN', 'USD'),
          accountId: fc.uuid()
        }),
        
        async (idempotencyKey, userId1, userId2, operationType, operationData) => {
          // Ensure users are different
          fc.pre(userId1 !== userId2);
          
          // First user uses the idempotency key
          const firstUserCheck = await idempotencyService.checkAndStore(
            idempotencyKey, 
            userId1, 
            operationType, 
            operationData
          );
          
          expect(firstUserCheck.isNew).toBe(true);
          
          // Second user uses the same idempotency key - should be allowed
          const secondUserCheck = await idempotencyService.checkAndStore(
            idempotencyKey, 
            userId2, 
            operationType, 
            operationData
          );
          
          expect(secondUserCheck.isNew).toBe(true);
          expect(secondUserCheck.lockAcquired).toBe(true);
          
          // But if first user tries to use same key with different params, should conflict
          const differentOperationData = {
            ...operationData,
            amount: operationData.amount + 1000
          };
          
          await expect(
            idempotencyService.checkAndStore(
              idempotencyKey, 
              userId1, 
              operationType, 
              differentOperationData
            )
          ).rejects.toThrow(IdempotencyConflictError);
        }
      ),
      { 
        numRuns: 25,
        timeout: 20000
      }
    );
  });

  /**
   * Property 1d: Key Expiration
   * 
   * Idempotency keys should expire after 24 hours and allow new operations.
   * 
   * Validates: Requirements 1.4, 1.5
   */
  test('Property 1d: Key Expiration - Expired keys allow new operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),                    // idempotency key
        fc.integer({ min: 1, max: 1000 }), // user ID
        fc.constantFrom('test_withdrawal', 'test_payment'), // operation type
        fc.record({                   // operation data
          amount: fc.integer({ min: 100, max: 1000000 }),
          currency: fc.constantFrom('NGN', 'USD'),
          accountId: fc.uuid()
        }),
        
        async (idempotencyKey, userId, operationType, operationData) => {
          // Create an expired idempotency key by directly inserting into database
          await sequelize.query(`
            INSERT INTO idempotency_keys (key, user_id, operation_type, operation_data, status, created_at, expires_at)
            VALUES (:key, :userId, :operationType, :operationData, 'completed', 
                    CURRENT_TIMESTAMP - INTERVAL '25 hours', 
                    CURRENT_TIMESTAMP - INTERVAL '1 hour')
          `, {
            replacements: {
              key: idempotencyKey,
              userId,
              operationType,
              operationData: JSON.stringify(operationData)
            }
          });
          
          // Now try to use the same key - should be allowed since it's expired
          const check = await idempotencyService.checkAndStore(
            idempotencyKey, 
            userId, 
            operationType, 
            operationData
          );
          
          expect(check.isNew).toBe(true);
          expect(check.lockAcquired).toBe(true);
        }
      ),
      { 
        numRuns: 20,
        timeout: 15000
      }
    );
  });

  /**
   * Property 1e: Operation Data Comparison
   * 
   * The system should correctly identify when operation parameters are 
   * identical vs different, regardless of key ordering.
   * 
   * Validates: Requirement 1.3
   */
  test('Property 1e: Operation Comparison - Key order independence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          amount: fc.integer({ min: 100, max: 1000000 }),
          currency: fc.constantFrom('NGN', 'USD'),
          accountId: fc.uuid(),
          metadata: fc.record({
            source: fc.string(),
            reference: fc.uuid()
          })
        }),
        
        async (operationData) => {
          // Create the same operation data with different key ordering
          const reorderedData = {
            currency: operationData.currency,
            metadata: {
              reference: operationData.metadata.reference,
              source: operationData.metadata.source
            },
            accountId: operationData.accountId,
            amount: operationData.amount
          };
          
          // These should be considered identical
          expect(idempotencyService.operationsMatch(operationData, reorderedData)).toBe(true);
          
          // But if we change a value, they should be different
          const differentData = {
            ...reorderedData,
            amount: operationData.amount + 1
          };
          
          expect(idempotencyService.operationsMatch(operationData, differentData)).toBe(false);
        }
      ),
      { 
        numRuns: 30,
        timeout: 10000
      }
    );
  });
});

/**
 * Unit Tests for Edge Cases
 */
describe('Idempotency Manager Unit Tests', () => {
  
  beforeEach(async () => {
    await sequelize.query('DELETE FROM idempotency_keys WHERE operation_type LIKE \'unit_test_%\'');
  });

  test('should reject invalid UUID format', async () => {
    await expect(
      idempotencyService.checkAndStore(
        'invalid-uuid',
        1,
        'unit_test_payment',
        { amount: 1000 }
      )
    ).rejects.toThrow('Invalid idempotency key format');
  });

  test('should reject missing parameters', async () => {
    await expect(
      idempotencyService.checkAndStore(
        idempotencyService.generateKey(),
        null, // missing userId
        'unit_test_payment',
        { amount: 1000 }
      )
    ).rejects.toThrow('Missing required parameters');
  });

  test('should handle concurrent access correctly', async () => {
    const key = idempotencyService.generateKey();
    const userId = 1;
    const operationType = 'unit_test_concurrent';
    const operationData = { amount: 1000, currency: 'NGN' };

    // Simulate concurrent requests
    const promises = Array(5).fill().map(() => 
      idempotencyService.checkAndStore(key, userId, operationType, operationData)
    );

    const results = await Promise.all(promises);

    // Only one should be new, others should be duplicates
    const newResults = results.filter(r => r.isNew);
    const duplicateResults = results.filter(r => !r.isNew);

    expect(newResults).toHaveLength(1);
    expect(duplicateResults.length).toBeGreaterThan(0);
  });
});