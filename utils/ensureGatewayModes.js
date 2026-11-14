const sequelize = require('../config/db');

/**
 * Storage for payment gateway live/test settings. Runs on boot like the other
 * ensure* helpers: every statement can run again safely and this never throws.
 * If it can't run, every payment stays live, exactly as before.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS gateway_settings (
    gateway VARCHAR(20) PRIMARY KEY,
    mode VARCHAR(10) NOT NULL DEFAULT 'live',
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS gateway_mode_changes (
    id BIGSERIAL PRIMARY KEY,
    gateway VARCHAR(20) NOT NULL,
    from_mode VARCHAR(10),
    to_mode VARCHAR(10) NOT NULL,
    note TEXT,
    changed_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS payment_test_accounts (
    user_id INTEGER PRIMARY KEY,
    added_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS test_payments (
    reference VARCHAR(255) PRIMARY KEY,
    gateway VARCHAR(20) NOT NULL,
    kind VARCHAR(30) NOT NULL,
    user_id INTEGER,
    amount NUMERIC(14, 2),
    currency VARCHAR(3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS test_payments_created ON test_payments (created_at DESC)',
];

async function ensureGatewayModes() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    await require('../services/gatewayModeService').start();
    console.log('✅ Payment gateway modes ready');
  } catch (error) {
    console.error('⚠️ Payment gateway mode setup failed; all payments stay live:', error.message);
  }
}

module.exports = { ensureGatewayModes };
