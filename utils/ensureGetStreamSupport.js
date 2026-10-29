const sequelize = require('../config/db');

/**
 * Prepares the live tables for GetStream on boot, before the server takes
 * requests:
 *   - adds 'getstream' to live_classes.streaming_provider (an enum),
 *   - adds live_classes.getstream_call_id (the class's current GetStream call),
 *   - adds live_series.streaming_provider (VARCHAR, default 'zegocloud', so
 *     every existing series keeps using ZegoCloud).
 *
 * Why at boot and not only in a migration: Render runs `node server.js`
 * without running migrations (see ensureLiveIdempotency.js). Every statement
 * is IF NOT EXISTS, so it is safe on every boot and alongside the migration.
 *
 * Fail-safe: if either change can't be applied (e.g. the DB user can't
 * ALTER), the column attribute is removed from the model at runtime and
 * `isGetStreamSchemaReady()` reports false. Creating a GetStream class is
 * then refused with a clear message, and every ZegoCloud flow behaves
 * exactly as before.
 */

let ready = false;
let seriesReady = false;

/** The Postgres type behind live_classes.streaming_provider, if it's an enum. */
const providerEnumType = async () => {
  const [rows] = await sequelize.query(
    `SELECT t.typname, t.typtype
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_type t ON t.oid = a.atttypid
      WHERE c.relname = 'live_classes'
        AND c.relnamespace = to_regnamespace(current_schema())
        AND a.attname = 'streaming_provider'`
  );
  const row = rows[0];
  return row && row.typtype === 'e' ? row.typname : null;
};

const providerAcceptsGetStream = async () => {
  const typeName = await providerEnumType();
  if (!typeName) return true; // not an enum (e.g. VARCHAR): any value is accepted
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = :typeName AND e.enumlabel = 'getstream'`,
    { replacements: { typeName } }
  );
  return rows.length > 0;
};

const columnExists = async (table, column) => {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = :table
        AND column_name = :column`,
    { replacements: { table, column } }
  );
  return rows.length > 0;
};

/** live_series.streaming_provider — independent of the live_classes changes. */
const ensureSeriesProvider = async () => {
  try {
    await sequelize.query(
      "ALTER TABLE live_series ADD COLUMN IF NOT EXISTS streaming_provider VARCHAR(20) NOT NULL DEFAULT 'zegocloud'"
    );
  } catch (error) {
    console.error('❌ Could not add streaming_provider to live_series:', error.message);
  }

  let present = false;
  try {
    present = await columnExists('live_series', 'streaming_provider');
  } catch (error) {
    console.error('❌ Could not verify live_series.streaming_provider:', error.message);
  }
  if (!present) {
    // Series then read as ZegoCloud, exactly as before.
    require('../models/LiveSeries').removeAttribute('streamingProvider');
  }
  return present;
};

const ensureGetStreamSupport = async () => {
  try {
    const typeName = await providerEnumType();
    if (typeName) {
      // ADD VALUE can't run inside a transaction block on older Postgres;
      // sequelize.query runs it on its own, outside any transaction.
      await sequelize.query(`ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS 'getstream'`);
    }
  } catch (error) {
    console.error('❌ Could not add getstream to streaming_provider:', error.message);
  }

  try {
    await sequelize.query('ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS getstream_call_id VARCHAR(64)');
  } catch (error) {
    console.error('❌ Could not add getstream_call_id to live_classes:', error.message);
  }

  let enumReady = false;
  let columnReady = false;
  try {
    enumReady = await providerAcceptsGetStream();
    columnReady = await columnExists('live_classes', 'getstream_call_id');
  } catch (error) {
    console.error('❌ Could not verify GetStream schema:', error.message);
  }

  if (!columnReady) {
    // Never query a column that doesn't exist.
    require('../models/liveClass').removeAttribute('getstream_call_id');
  }

  ready = enumReady && columnReady;
  if (ready) {
    console.log('✅ GetStream schema verified');
  } else {
    console.warn('⚠️ GetStream schema unavailable — GetStream live classes are disabled; ZegoCloud is unaffected');
  }

  seriesReady = await ensureSeriesProvider();
  if (seriesReady) {
    console.log('✅ GetStream series schema verified');
  } else {
    console.warn('⚠️ GetStream series schema unavailable — GetStream live series are disabled; ZegoCloud is unaffected');
  }
};

/** Whether live_classes can store GetStream classes. */
const isGetStreamSchemaReady = () => ready;

/** Whether live_series can store a provider choice. */
const isGetStreamSeriesSchemaReady = () => seriesReady;

module.exports = { ensureGetStreamSupport, isGetStreamSchemaReady, isGetStreamSeriesSchemaReady };
