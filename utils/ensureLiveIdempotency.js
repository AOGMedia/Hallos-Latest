const sequelize = require('../config/db');

/**
 * Adds the idempotency_key column (and its partial unique index) to
 * live_classes and live_series on boot, before the server starts taking
 * requests.
 *
 * Why at boot and not only in a migration: Render runs `npm install` then
 * `node server.js` — migrations are never run on deploy, and
 * sequelize.sync({ force: false }) never adds columns to existing tables.
 * Both models now declare `idempotencyKey`, so Sequelize includes the
 * column in every SELECT and INSERT on these tables. If the column were
 * missing, every live class and series read/create would fail. This makes
 * the schema match the code before the first request, the same way
 * ensurePaymentTables does for the payment tables. Every statement is
 * IF NOT EXISTS, so it is safe on every boot and safe alongside the
 * matching migrations.
 *
 * Fail-safe: if the column still isn't present afterwards (e.g. the DB user
 * can't ALTER), the attribute is removed from the model at runtime and
 * `isLiveIdempotencyEnabled()` reports false. The create endpoints then
 * behave exactly as they did before this change instead of failing.
 */
const TABLES = [
  { table: 'live_classes', index: 'idx_live_classes_idempotency_key_unique', modelPath: '../models/liveClass' },
  { table: 'live_series', index: 'idx_live_series_idempotency_key_unique', modelPath: '../models/LiveSeries' }
];

const enabled = { live_classes: false, live_series: false };

const columnExists = async (table) => {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = :table
        AND column_name = 'idempotency_key'`,
    { replacements: { table } }
  );
  return rows.length > 0;
};

const ensureLiveIdempotency = async () => {
  for (const { table, index, modelPath } of TABLES) {
    try {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255)`);
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ${table} (idempotency_key) WHERE idempotency_key IS NOT NULL`
      );
    } catch (error) {
      console.error(`❌ Could not add idempotency_key to ${table}:`, error.message);
    }

    let present = false;
    try {
      present = await columnExists(table);
    } catch (error) {
      console.error(`❌ Could not verify idempotency_key on ${table}:`, error.message);
    }

    enabled[table] = present;
    if (!present) {
      // Keep the app working exactly as before rather than querying a
      // column that doesn't exist.
      require(modelPath).removeAttribute('idempotencyKey');
      console.warn(`⚠️ idempotency_key unavailable on ${table} — duplicate-create protection disabled for it`);
    }
  }
  console.log(`✅ Live idempotency verified (live_classes: ${enabled.live_classes}, live_series: ${enabled.live_series})`);
};

/** Whether duplicate-create protection is active for the given table. */
const isLiveIdempotencyEnabled = (table) => enabled[table] === true;

module.exports = { ensureLiveIdempotency, isLiveIdempotencyEnabled };
