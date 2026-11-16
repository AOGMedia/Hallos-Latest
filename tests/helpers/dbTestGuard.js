/**
 * Tests that read and write a real Postgres database.
 *
 * tests/setup.js loads .env, which points at a real database (possibly
 * production). These tests create and delete users, live classes and
 * idempotency keys, so they must never run against it. They run only when
 * asked for explicitly AND the database name says it's a test one:
 *
 *   RUN_DB_TESTS=true DB_NAME=hallos_test DB_HOST=... npx jest
 *
 * Otherwise they are skipped (and say why), so `npm test` is always safe.
 */
const dbName = String(process.env.DB_NAME || '');
const dbTestsEnabled = process.env.RUN_DB_TESTS === 'true' && /test/i.test(dbName);

const describeWithDb = dbTestsEnabled ? describe : describe.skip;

if (!dbTestsEnabled && process.env.RUN_DB_TESTS === 'true') {
  // Asked for, but the database doesn't look like a test one: refuse loudly.
  // eslint-disable-next-line no-console
  console.warn(`[db tests] Skipped: DB_NAME "${dbName}" doesn't look like a test database (it must contain "test").`);
}

module.exports = { describeWithDb, dbTestsEnabled };
