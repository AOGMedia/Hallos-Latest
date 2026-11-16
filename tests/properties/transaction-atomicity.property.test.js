const fc = require('fast-check');
const sequelize = require('../../config/db');
require('../../models/WalletAccount'); // registers sequelize.models.WalletAccount, which the service uses
const transactionService = require('../../services/databaseTransactionService');
// Reads and writes wallets in a real database: runs only against a test one (see tests/helpers/dbTestGuard.js).
const { describeWithDb } = require('../helpers/dbTestGuard');

/**
 * Property-Based Tests for the Database Transaction Service
 *
 * **Property 2: Database Transaction Atomicity**
 * **Validates: Requirements 2.1, 2.2**
 *
 * The service is used by the wallet, missed-earnings and stuck-payment code,
 * so these run against real Postgres (row locks and rollbacks can't be
 * faked meaningfully). They check that:
 * 1. Successful operations commit; failed ones roll back completely
 * 2. Concurrent operations on one wallet are serialized (no lost updates)
 * 3. Concurrent debits can never overdraw a wallet
 * 4. Multi-wallet operations are all-or-nothing
 * 5. Retry logic retries only deadlock/serialization errors
 *
 * (Rewritten: the first version used fc.property with async callbacks that
 * were never awaited, an in-memory SQLite table the service never touched,
 * and methods the service doesn't have.)
 */

const TEST_EMAILS = ['atomicity-a@test.invalid', 'atomicity-b@test.invalid'];
const users = { a: null, b: null };

async function createTestUsers() {
  const ids = [];
  for (const email of TEST_EMAILS) {
    const [rows] = await sequelize.query(
      `INSERT INTO "Users" (firstname, lastname, email, role, "createdAt", "updatedAt")
       VALUES ('Atomicity', 'Test', :email, 'viewer', NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET firstname = EXCLUDED.firstname
       RETURNING id`,
      { replacements: { email } }
    );
    ids.push(rows[0].id);
  }
  [users.a, users.b] = ids;
}

async function removeTestUsers() {
  await sequelize.query(`DELETE FROM wallet_accounts WHERE user_id IN (:ids)`, { replacements: { ids: [users.a, users.b] } });
  await sequelize.query(`DELETE FROM "Users" WHERE email IN (:emails)`, { replacements: { emails: TEST_EMAILS } });
}

/** Puts a wallet at an exact starting balance (creating it if needed). */
async function setWallet(userId, currency, available, pending = 0) {
  await sequelize.query(
    `INSERT INTO wallet_accounts (id, user_id, currency, balance_available, balance_pending, created_at, updated_at)
     VALUES (gen_random_uuid(), :userId, :currency, :available, :pending, NOW(), NOW())
     ON CONFLICT (user_id, currency) DO UPDATE SET balance_available = EXCLUDED.balance_available, balance_pending = EXCLUDED.balance_pending`,
    { replacements: { userId, currency, available, pending } }
  );
}

async function balanceOf(userId, currency) {
  const [rows] = await sequelize.query(
    'SELECT balance_available, balance_pending FROM wallet_accounts WHERE user_id = :userId AND currency = :currency',
    { replacements: { userId, currency } }
  );
  return rows[0] ? { available: Number(rows[0].balance_available), pending: Number(rows[0].balance_pending) } : null;
}

const credit = (amount) => async (wallet, transaction) => transactionService.updateWalletBalance(wallet, amount, 0, transaction);
const debit = (amount) => async (wallet, transaction) => transactionService.updateWalletBalance(wallet, -amount, 0, transaction);
const currencyArb = fc.constantFrom('NGN', 'USD');

describeWithDb('Database Transaction Atomicity Property Tests', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    await createTestUsers();
  });

  afterAll(async () => {
    await removeTestUsers();
    await sequelize.close();
  });

  describe('Property 2: Database Transaction Atomicity', () => {
    test('should commit all changes when operation succeeds', async () => {
      await fc.assert(
        fc.asyncProperty(currencyArb, fc.integer({ min: 1000, max: 1000000 }), fc.integer({ min: 100, max: 50000 }), async (currency, initial, amount) => {
          await setWallet(users.a, currency, initial);

          const wallet = await transactionService.executeWalletOperation(users.a, currency, credit(amount));

          expect(Number(wallet.balance_available)).toBe(initial + amount);
          expect(await balanceOf(users.a, currency)).toEqual({ available: initial + amount, pending: 0 });
        }),
        { numRuns: 15 }
      );
    });

    test('should rollback all changes when operation fails', async () => {
      await fc.assert(
        fc.asyncProperty(currencyArb, fc.integer({ min: 1000, max: 10000 }), fc.integer({ min: 20000, max: 100000 }), async (currency, initial, tooMuch) => {
          await setWallet(users.a, currency, initial);

          await expect(transactionService.executeWalletOperation(users.a, currency, debit(tooMuch))).rejects.toThrow('Insufficient balance');

          expect(await balanceOf(users.a, currency)).toEqual({ available: initial, pending: 0 });
        }),
        { numRuns: 15 }
      );
    });

    test('should preserve data integrity when errors occur after a change', async () => {
      await fc.assert(
        fc.asyncProperty(currencyArb, fc.integer({ min: 1000, max: 100000 }), fc.integer({ min: 1, max: 999 }), async (currency, initial, amount) => {
          await setWallet(users.a, currency, initial);

          // A change is made, then something later in the same operation fails: the change must not stick.
          await expect(
            transactionService.executeWalletOperation(users.a, currency, async (wallet, transaction) => {
              await transactionService.updateWalletBalance(wallet, amount, 0, transaction);
              throw new Error('later step failed');
            })
          ).rejects.toThrow('later step failed');

          expect(await balanceOf(users.a, currency)).toEqual({ available: initial, pending: 0 });
        }),
        { numRuns: 15 }
      );
    });

    test('should serialize concurrent operations on the same wallet (no lost updates)', async () => {
      await fc.assert(
        fc.asyncProperty(currencyArb, fc.integer({ min: 10000, max: 100000 }), fc.array(fc.integer({ min: 100, max: 1000 }), { minLength: 3, maxLength: 8 }), async (currency, initial, amounts) => {
          await setWallet(users.a, currency, initial);

          await Promise.all(amounts.map((amount) => transactionService.executeWalletOperation(users.a, currency, credit(amount))));

          const total = amounts.reduce((sum, a) => sum + a, 0);
          expect((await balanceOf(users.a, currency)).available).toBe(initial + total);
        }),
        { numRuns: 10 }
      );
    });

    test('should never let concurrent debits overdraw a wallet', async () => {
      await fc.assert(
        fc.asyncProperty(currencyArb, fc.integer({ min: 1000, max: 5000 }), fc.integer({ min: 300, max: 900 }), fc.integer({ min: 3, max: 8 }), async (currency, initial, amount, attempts) => {
          await setWallet(users.a, currency, initial);

          const results = await Promise.allSettled(
            Array.from({ length: attempts }, () => transactionService.executeWalletOperation(users.a, currency, debit(amount)))
          );
          const succeeded = results.filter((r) => r.status === 'fulfilled').length;

          // Exactly as many as the balance covers, never more, and the balance never goes below zero.
          expect(succeeded).toBe(Math.min(attempts, Math.floor(initial / amount)));
          const after = (await balanceOf(users.a, currency)).available;
          expect(after).toBe(initial - succeeded * amount);
          expect(after).toBeGreaterThanOrEqual(0);
          results.filter((r) => r.status === 'rejected').forEach((r) => expect(r.reason.message).toBe('Insufficient balance'));
        }),
        { numRuns: 10 }
      );
    });

    test('should execute multi-wallet operations atomically', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1000, max: 50000 }), fc.integer({ min: 100, max: 900 }), async (initial, amount) => {
          await setWallet(users.a, 'NGN', initial);
          await setWallet(users.b, 'NGN', initial);

          // Move money a -> b in one go.
          await transactionService.executeMultiWalletOperation(users.a, [
            { userId: users.a, currency: 'NGN', operation: debit(amount) },
            { userId: users.b, currency: 'NGN', operation: credit(amount) },
          ]);
          expect((await balanceOf(users.a, 'NGN')).available).toBe(initial - amount);
          expect((await balanceOf(users.b, 'NGN')).available).toBe(initial + amount);

          // A second step that fails undoes the first: nothing moves.
          await expect(
            transactionService.executeMultiWalletOperation(users.a, [
              { userId: users.b, currency: 'NGN', operation: credit(amount) },
              { userId: users.a, currency: 'NGN', operation: debit(initial * 10) },
            ])
          ).rejects.toThrow('Insufficient balance');
          expect((await balanceOf(users.a, 'NGN')).available).toBe(initial - amount);
          expect((await balanceOf(users.b, 'NGN')).available).toBe(initial + amount);
        }),
        { numRuns: 10 }
      );
    });

    test('should create wallets atomically within transactions (once only)', async () => {
      await sequelize.query('DELETE FROM wallet_accounts WHERE user_id = :id AND currency = :currency', { replacements: { id: users.b, currency: 'USD' } });

      const first = await transactionService.executeWithTransaction((t) => transactionService.createWalletInTransaction(users.b, 'USD', t));
      const second = await transactionService.executeWithTransaction((t) => transactionService.createWalletInTransaction(users.b, 'USD', t));

      expect(second.id).toBe(first.id);
      expect(await balanceOf(users.b, 'USD')).toEqual({ available: 0, pending: 0 });

      // A wallet created in a transaction that then fails doesn't exist afterwards.
      await sequelize.query('DELETE FROM wallet_accounts WHERE user_id = :id AND currency = :currency', { replacements: { id: users.b, currency: 'USD' } });
      await expect(
        transactionService.executeWithTransaction(async (t) => {
          await transactionService.createWalletInTransaction(users.b, 'USD', t);
          throw new Error('abort');
        })
      ).rejects.toThrow('abort');
      expect(await balanceOf(users.b, 'USD')).toBeNull();
    });

    test('should handle operations on a wallet that does not exist yet', async () => {
      await sequelize.query('DELETE FROM wallet_accounts WHERE user_id = :id AND currency = :currency', { replacements: { id: users.b, currency: 'NGN' } });

      await expect(transactionService.executeWalletOperation(users.b, 'NGN', debit(100))).rejects.toThrow('Insufficient balance');
      // The wallet created for the failed attempt was rolled back with it.
      expect(await balanceOf(users.b, 'NGN')).toBeNull();

      await transactionService.executeWalletOperation(users.b, 'NGN', credit(250));
      expect(await balanceOf(users.b, 'NGN')).toEqual({ available: 250, pending: 0 });
    });
  });

  describe('Retry logic', () => {
    const dbError = (message) => Object.assign(new Error(message), { name: 'SequelizeDatabaseError' });

    test('retries deadlock and serialization errors, then succeeds', async () => {
      for (const message of ['deadlock detected', 'could not serialize access due to concurrent update']) {
        let calls = 0;
        const result = await transactionService.executeWithRetry(async () => {
          calls += 1;
          if (calls < 3) throw dbError(message);
          return 'done';
        }, 3);
        expect(result).toBe('done');
        expect(calls).toBe(3);
      }
    });

    test('does not retry other errors', async () => {
      let calls = 0;
      await expect(
        transactionService.executeWithRetry(async () => {
          calls += 1;
          throw new Error('Insufficient balance');
        }, 3)
      ).rejects.toThrow('Insufficient balance');
      expect(calls).toBe(1);
    });

    test('gives up after the maximum attempts', async () => {
      let calls = 0;
      await expect(
        transactionService.executeWithRetry(async () => {
          calls += 1;
          throw dbError('deadlock detected');
        }, 2)
      ).rejects.toThrow('deadlock detected');
      expect(calls).toBe(2);
    });

    test('isInTransaction reflects whether a transaction is still open', async () => {
      const t = await transactionService.getTransaction();
      expect(transactionService.isInTransaction(t)).toBe(true);
      await t.rollback();
      expect(transactionService.isInTransaction(t)).toBe(false);
      expect(Boolean(transactionService.isInTransaction(null))).toBe(false);
    });
  });
});
