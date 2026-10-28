const sequelize = require('../config/db');

/**
 * Creates tables that sequelize.sync() never builds - either they have no
 * model (idempotency_keys, audit_logs) or the model is only required lazily
 * inside a controller (live_series_registrations).
 * Safe to run on every boot: every statement is IF NOT EXISTS.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    key UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL,
    operation_data JSONB NOT NULL,
    result_data JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'processing'
      CHECK (status IN ('processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
  )`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_user_id ON idempotency_keys (user_id)`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at ON idempotency_keys (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_operation_type ON idempotency_keys (operation_type)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE SET NULL,
    operation_type VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    request_id UUID,
    session_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hash_chain VARCHAR(64)
  )`,
  `CREATE INDEX IF NOT EXISTS audit_logs_user_id ON audit_logs (user_id)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_operation_type ON audit_logs (operation_type)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_resource_type ON audit_logs (resource_type)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_created_at ON audit_logs (created_at)`,
  `CREATE TABLE IF NOT EXISTS live_series_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id UUID NOT NULL REFERENCES live_series(id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_live_series_registrations_series_id ON live_series_registrations (series_id)`,
  `CREATE INDEX IF NOT EXISTS idx_live_series_registrations_user_id ON live_series_registrations (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_live_series_registrations_unique ON live_series_registrations (series_id, user_id)`
];

const ensureSupportTables = async () => {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    console.log('✅ Support tables verified (idempotency_keys, audit_logs, live_series_registrations)');
  } catch (error) {
    console.error('❌ Failed to verify support tables:', error.message);
  }
};

module.exports = { ensureSupportTables, STATEMENTS };
