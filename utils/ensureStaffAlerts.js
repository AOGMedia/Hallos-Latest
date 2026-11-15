const sequelize = require('../config/db');

/**
 * Storage for staff email alerts: which alerts each staff member turned on,
 * and when they were last emailed (for the quiet period). Runs on boot like
 * the other ensure* helpers: safe to repeat, never throws. If it can't run,
 * no alerts are sent and nothing else changes.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS staff_alert_settings (
    user_id INTEGER NOT NULL,
    alert_key VARCHAR(60) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_sent_at TIMESTAMPTZ,
    skipped INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, alert_key)
  )`,
  'CREATE INDEX IF NOT EXISTS staff_alert_settings_on ON staff_alert_settings (alert_key) WHERE enabled',
];

let ready = false;

async function ensureStaffAlerts() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    ready = true;
    console.log('✅ Staff alerts ready');
  } catch (error) {
    console.error('⚠️ Staff alerts setup failed; no alert emails will be sent:', error.message);
  }
}

module.exports = { ensureStaffAlerts, isStaffAlertsReady: () => ready };
