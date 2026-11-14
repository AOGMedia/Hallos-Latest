const sequelize = require('../config/db');

/**
 * Storage for staff-editable platform settings. Runs on boot like the other
 * ensure* helpers: every statement can run again safely and this never
 * throws. If it can't run, every setting keeps its built-in default.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS platform_settings (
    key VARCHAR(80) PRIMARY KEY,
    value NUMERIC(16, 2) NOT NULL,
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS platform_setting_changes (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(80) NOT NULL,
    from_value NUMERIC(16, 2),
    to_value NUMERIC(16, 2),
    note TEXT,
    changed_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS platform_setting_changes_created ON platform_setting_changes (created_at DESC)',
];

async function ensurePlatformSettings() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    await require('../services/platformSettingsService').start();
    console.log('✅ Platform settings ready');
  } catch (error) {
    console.error('⚠️ Platform settings setup failed; built-in defaults apply:', error.message);
  }
}

module.exports = { ensurePlatformSettings };
