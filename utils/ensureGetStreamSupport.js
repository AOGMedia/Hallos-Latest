const sequelize = require('../config/db');

/**
 * Prepares live_classes for GetStream on boot, before the server takes
 * requests:
 *   - adds 'getstream' to the streaming_provider enum, and
 *   - adds the getstream_call_id column (the class's current GetStream call).
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

const callIdColumnExists = async () => {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'live_classes'
        AND column_name = 'getstream_call_id'`
  );
  return rows.length > 0;
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
    columnReady = await callIdColumnExists();
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
};

/** Whether live_classes can store GetStream classes. */
const isGetStreamSchemaReady = () => ready;

module.exports = { ensureGetStreamSupport, isGetStreamSchemaReady };
