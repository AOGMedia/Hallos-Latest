const sequelize = require('../config/db');

/**
 * Creates the tables behind the admin user page on boot (Render runs
 * `node server.js` without migrations). Every statement is safe to repeat.
 *
 * Separate tables, no Sequelize models and no change to Users, so a problem
 * here can't stop the server or affect logins. This never throws: if it can't
 * run, sending personal emails and adjusting wallets from the admin are refused
 * with a clear message and everything else carries on.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_login_stats (
    user_id INTEGER PRIMARY KEY,
    last_login_at TIMESTAMPTZ NOT NULL,
    login_count INTEGER NOT NULL DEFAULT 1,
    last_method VARCHAR(20),
    last_ip VARCHAR(64),
    last_user_agent TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS admin_user_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_html TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'sending',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS admin_user_emails_user ON admin_user_emails (user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_wallet_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    admin_id INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key UUID NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    balance_after NUMERIC(14, 2),
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS admin_wallet_adjustments_user ON admin_wallet_adjustments (user_id, created_at DESC)`,
];

let ready = false;

const isUserInsightsReady = () => ready;

async function ensureUserInsights() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    ready = true;
    console.log('✅ User insight tables ready');
  } catch (error) {
    ready = false;
    console.error('⚠️ User insight setup failed; admin emails and wallet adjustments are unavailable:', error.message);
  }
}

module.exports = { ensureUserInsights, isUserInsightsReady };
