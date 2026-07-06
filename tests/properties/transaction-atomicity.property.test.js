const fc = require('fast-check');
const { Sequelize } = require('sequelize');
const databaseTransactionService = require('../../services/databaseTransactionService');

/**
 * Property-Based Tests for Database Transaction Service
 * 
 * **Property 2: Database Transaction Atomicity**
 * **Validates: Requirements 2.1, 2.2**
 * 
 * These tests verify that:
 * 1. All database changes complete successfully or all changes are rolled back
 * 2. Concurrent operations on the same wallet are properly serialized
 * 3. Row-level locking prevents race conditions
 * 4. Deadlock detection and retry logic work correctly
 * 5. Transaction boundaries are properly maintained
 */

describe('Database Transaction Atomicity Property Tests', () => {
  let sequelize;
  let transactionService;
  let WalletAccount;

  beforeAll(async () => {
    // Create in-memory SQLite database for testing with better configuration
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
      define: {
        timestamps: true,
        underscored: true
      },
      pool: {
        max: 1,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    });

    // Define WalletAccount model for testing
    WalletAccount = sequelize.define('WalletAccount', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false
      },
      balance_available: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0
      },
      balance_pending: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0
      }
    }, {
      tableName: 'wallet_accounts',
      indexes: [
        {
          unique: true,
          fields: ['user_id', 'currency']
        }
      ]
    });

    await sequelize.sync({ force: true });
    transactionService = databaseTransactionService;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await WalletAccount.destroy({ where: {}, truncate: true });
  });

  describe('Property 2: Database Transaction Atomicity', () => {

    // Test that successful operations commit all changes
    test('should commit all changes when operation succeeds', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000 }), // userId
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.integer({ min: 1000, max: 1000000 }), // initial balance
        fc.integer({ min: 100, max: 50000 }), // credit amount
        async (userId, currency, initialBalance, creditAmount) => {
          // Create initial wallet
          await WalletAccount.create({
            user_id: userId,
            currency: currency,
            balance_available: initialBalance,
            balance_pending: 0
          });

          // Execute credit operation
          const result = await transactionService.executeWalletOperation(
            userId,
            currency,
            async (wallet, transaction) => {
              await transactionService.updateWalletBalance(
                wallet,
                creditAmount,
                0,
                transaction
              );
              return { success: true, newBalance: wallet.balance_available + creditAmount };
            },
            { operationType: 'credit' }
          );

          // Verify the operation succeeded
          expect(result.success).toBe(true);
          expect(result.newBalance).toBe(initialBalance + creditAmount);

          // Verify the changes were committed to the database
          const updatedWallet = await WalletAccount.findOne({
            where: { user_id: userId, currency: currency }
          });

          expect(updatedWallet.balance_available).toBe(initialBalance + creditAmount);
          expect(updatedWallet.balance_pending).toBe(0);
        }
      ), { numRuns: 30 });
    });

    // Test that failed operations rollback all changes
    test('should rollback all changes when operation fails', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000 }), // userId
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.integer({ min: 1000, max: 10000 }), // initial balance
        fc.integer({ min: 20000, max: 100000 }), // debit amount (larger than balance)
        async (userId, currency, initialBalance, debitAmount) => {
          // Create initial wallet
          await WalletAccount.create({
            user_id: userId,
            currency: currency,
            balance_available: initialBalance,
            balance_pending: 0
          });

          // Execute debit operation that should fail due to insufficient funds
          let operationFailed = false;
          try {
            await transactionService.executeWalletOperation(
              userId,
              currency,
              async (wallet, transaction) => {
                // This should throw InsufficientFundsError
                await transactionService.updateWalletBalance(
                  wallet,
                  -debitAmount, // Negative amount (debit)
                  0,
                  transaction
                );
                return { success: true };
              },
              { operationType: 'debit' }
            );
          } catch (error) {
            operationFailed = true;
            // Service throws generic Error for insufficient funds
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('Insufficient');
          }

          // Verify the operation failed
          expect(operationFailed).toBe(true);

          // Verify the wallet balance was not changed (rollback occurred)
          const unchangedWallet = await WalletAccount.findOne({
            where: { user_id: userId, currency: currency }
          });

          expect(unchangedWallet.balance_available).toBe(initialBalance);
          expect(unchangedWallet.balance_pending).toBe(0);
        }
      ), { numRuns: 30 });
    });

    // Test that concurrent operations are properly serialized
    test('should serialize concurrent operations on the same wallet', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 100 }), // userId
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.integer({ min: 10000, max: 100000 }), // initial balance
        fc.array(fc.integer({ min: 100, max: 1000 }), { minLength: 3, maxLength: 10 }), // credit amounts
        async (userId, currency, initialBalance, creditAmounts) => {
          // Create initial wallet
          await WalletAccount.create({
            user_id: userId,
            currency: currency,
            balance_available: initialBalance,
            balance_pending: 0
          });

          // Execute multiple concurrent credit operations
          const operations = creditAmounts.map(amount => 
            transactionService.executeWalletOperation(
              userId,
              currency,
              async (wallet, transaction) => {
                await transactionService.updateWalletBalance(
                  wallet,
                  amount,
                  0,
                  transaction
                );
                return amount;
              },
              { operationType: 'concurrent_credit' }
            )
          );

          // Wait for all operations to complete
          const results = await Promise.all(operations);

          // Verify all operations succeeded
          expect(results).toHaveLength(creditAmounts.length);
          results.forEach((result, index) => {
            expect(result).toBe(creditAmounts[index]);
          });

          // Verify the final balance is correct (sum of all credits)
          const totalCredits = creditAmounts.reduce((sum, amount) => sum + amount, 0);
          const finalWallet = await WalletAccount.findOne({
            where: { user_id: userId, currency: currency }
          });

          expect(finalWallet.balance_available).toBe(initialBalance + totalCredits);
        }
      ), { numRuns: 20 });
    });

    // Test multi-wallet operations are atomic
    test('should execute multi-wallet operations atomically', () => {
      fc.assert(fc.property(
        fc.array(
          fc.record({
            userId: fc.integer({ min: 1, max: 100 }),
            currency: fc.oneof(fc.constant('NGN'), fc.constant('USD')),
            initialBalance: fc.integer({ min: 10000, max: 100000 }),
            transferAmount: fc.integer({ min: 100, max: 5000 })
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (walletConfigs) => {
          // Create initial wallets
          for (const config of walletConfigs) {
            await WalletAccount.create({
              user_id: config.userId,
              currency: config.currency,
              balance_available: config.initialBalance,
              balance_pending: 0
            });
          }

          // Prepare multi-wallet transfer operations
          const operations = [];
          for (let i = 0; i < walletConfigs.length - 1; i++) {
            const sender = walletConfigs[i];
            const receiver = walletConfigs[i + 1];

            // Only transfer if currencies match
            if (sender.currency === receiver.currency) {
              operations.push({
                userId: sender.userId,
                currency: sender.currency,
                operation: async (wallet, transaction) => {
                  await transactionService.updateWalletBalance(
                    wallet,
                    -sender.transferAmount, // Debit sender
                    0,
                    transaction
                  );
                  return { type: 'debit', amount: sender.transferAmount };
                }
              });

              operations.push({
                userId: receiver.userId,
                currency: receiver.currency,
                operation: async (wallet, transaction) => {
                  await transactionService.updateWalletBalance(
                    wallet,
                    sender.transferAmount, // Credit receiver
                    0,
                    transaction
                  );
                  return { type: 'credit', amount: sender.transferAmount };
                }
              });
            }
          }

          if (operations.length === 0) {
            return; // Skip if no valid operations
          }

          // Execute multi-wallet operation
          const results = await transactionService.executeMultiWalletOperation(
            operations,
            { operationType: 'multi_transfer' }
          );

          // Verify all operations completed
          expect(results).toHaveLength(operations.length);

          // Verify balances are updated correctly
          for (let i = 0; i < walletConfigs.length - 1; i++) {
            const sender = walletConfigs[i];
            const receiver = walletConfigs[i + 1];

            if (sender.currency === receiver.currency) {
              const senderWallet = await WalletAccount.findOne({
                where: { user_id: sender.userId, currency: sender.currency }
              });
              const receiverWallet = await WalletAccount.findOne({
                where: { user_id: receiver.userId, currency: receiver.currency }
              });

              expect(senderWallet.balance_available).toBe(sender.initialBalance - sender.transferAmount);
              expect(receiverWallet.balance_available).toBe(receiver.initialBalance + sender.transferAmount);
            }
          }
        }
      ), { numRuns: 15 });
    });

    // Test that wallet creation is atomic
    test('should create wallets atomically within transactions', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000 }), // userId
        fc.array(fc.oneof(fc.constant('NGN'), fc.constant('USD')), { minLength: 1, maxLength: 2 }), // currencies
        async (userId, currencies) => {
          // Remove duplicates
          const uniqueCurrencies = [...new Set(currencies)];

          const result = await transactionService.executeWithTransaction(
            async (transaction) => {
              const createdWallets = [];
              
              for (const currency of uniqueCurrencies) {
                const wallet = await transactionService.createWalletInTransaction(
                  userId,
                  currency,
                  transaction
                );
                createdWallets.push(wallet);
              }
              
              return createdWallets;
            },
            { operationType: 'create_wallets', userId }
          );

          // Verify all wallets were created
          expect(result).toHaveLength(uniqueCurrencies.length);

          // Verify wallets exist in database
          for (const currency of uniqueCurrencies) {
            const wallet = await WalletAccount.findOne({
              where: { user_id: userId, currency: currency }
            });
            
            expect(wallet).not.toBeNull();
            expect(wallet.balance_available).toBe(0);
            expect(wallet.balance_pending).toBe(0);
          }
        }
      ), { numRuns: 30 });
    });

    // Test error handling preserves data integrity
    test('should preserve data integrity when errors occur', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 100 }), // userId
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        fc.integer({ min: 1000, max: 10000 }), // initial balance
        async (userId, currency, initialBalance) => {
          // Create initial wallet
          await WalletAccount.create({
            user_id: userId,
            currency: currency,
            balance_available: initialBalance,
            balance_pending: 0
          });

          // Execute operation that will fail midway
          let operationFailed = false;
          try {
            await transactionService.executeWalletOperation(
              userId,
              currency,
              async (wallet, transaction) => {
                // First, update the balance (this should succeed)
                await transactionService.updateWalletBalance(
                  wallet,
                  1000, // Credit 1000
                  0,
                  transaction
                );

                // Then throw an error (this should cause rollback)
                throw new Error('Simulated operation failure');
              },
              { operationType: 'failing_operation' }
            );
          } catch (error) {
            operationFailed = true;
            expect(error.message).toContain('Simulated operation failure');
          }

          // Verify the operation failed
          expect(operationFailed).toBe(true);

          // Verify the wallet balance was not changed (complete rollback)
          const unchangedWallet = await WalletAccount.findOne({
            where: { user_id: userId, currency: currency }
          });

          expect(unchangedWallet.balance_available).toBe(initialBalance);
          expect(unchangedWallet.balance_pending).toBe(0);
        }
      ), { numRuns: 25 });
    });

    // Test that non-existent wallet operations fail gracefully
    test('should handle non-existent wallet operations gracefully', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1000, max: 9999 }), // non-existent userId
        fc.oneof(fc.constant('NGN'), fc.constant('USD')), // currency
        async (userId, currency) => {
          // Try to operate on non-existent wallet
          let operationFailed = false;
          try {
            await transactionService.executeWalletOperation(
              userId,
              currency,
              async (wallet, transaction) => {
                // This should never be reached
                return { success: true };
              },
              { operationType: 'non_existent_wallet' }
            );
          } catch (error) {
            operationFailed = true;
            // Service throws generic Error for wallet not found
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain(`Wallet not found for user ${userId} and currency ${currency}`);
          }

          // Verify the operation failed appropriately
          expect(operationFailed).toBe(true);

          // Verify no wallet was created
          const wallet = await WalletAccount.findOne({
            where: { user_id: userId, currency: currency }
          });
          expect(wallet).toBeNull();
        }
      ), { numRuns: 20 });
    });
  });

  describe('Transaction Service Configuration Properties', () => {

    test('should have valid retry configuration', () => {
      const stats = transactionService.getStats();
      
      expect(stats.maxRetries).toBeGreaterThan(0);
      expect(stats.maxRetries).toBeLessThanOrEqual(10);
      expect(stats.baseDelay).toBeGreaterThan(0);
      expect(stats.maxDelay).toBeGreaterThan(stats.baseDelay);
    });

    test('should calculate exponential backoff delays correctly', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 5 }), // attempt number
        (attempt) => {
          const delay = transactionService.calculateDelay(attempt);
          
          // Delay should be positive
          expect(delay).toBeGreaterThan(0);
          
          // Delay should not exceed maximum
          expect(delay).toBeLessThanOrEqual(transactionService.maxDelay);
          
          // Delay should generally increase with attempt number (allowing for jitter)
          if (attempt > 1) {
            const previousDelay = transactionService.calculateDelay(attempt - 1);
            // Allow for some variance due to jitter, but expect general increase
            expect(delay).toBeGreaterThanOrEqual(previousDelay * 0.5);
          }
        }
      ), { numRuns: 20 });
    });

    test('should identify retryable errors correctly', () => {
      // Test retryable error patterns
      const retryableErrors = [
        { original: { code: '40001', message: 'serialization failure' } },
        { original: { code: '40P01', message: 'deadlock detected' } },
        { original: { message: 'deadlock detected while waiting' } },
        { original: { message: 'could not serialize access due to concurrent update' } }
      ];

      retryableErrors.forEach(error => {
        expect(transactionService.isRetryableError(error)).toBe(true);
      });

      // Test non-retryable errors
      const nonRetryableErrors = [
        { original: { code: '23505', message: 'duplicate key value' } },
        { original: { code: '23503', message: 'foreign key violation' } },
        { message: 'validation error' },
        {}
      ];

      nonRetryableErrors.forEach(error => {
        expect(transactionService.isRetryableError(error)).toBe(false);
      });
    });
  });
});