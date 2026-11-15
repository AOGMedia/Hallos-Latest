const sequelize = require('../config/db');

/**
 * Storage for account deletion requests. Runs on boot like the other ensure*
 * helpers: safe to repeat, never throws. If it can't run, people can't ask to
 * delete their account (they get a clear message) and nothing else changes.
 *
 * At most one open (pending) request per person, enforced by the partial
 * unique index.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scheduled_for TIMESTAMPTZ NOT NULL,
    cancelled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    completed_by INTEGER,
    rejected_at TIMESTAMPTZ,
    rejected_by INTEGER,
    staff_note TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_one_open
     ON account_deletion_requests (user_id) WHERE status = 'pending'`,
  'CREATE INDEX IF NOT EXISTS account_deletion_status ON account_deletion_requests (status, scheduled_for)',
];

let ready = false;

async function ensureAccountDeletion() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    ready = true;
    require('../services/accountDeletionService').startRefreshing();
    console.log('✅ Account deletion ready');
  } catch (error) {
    console.error('⚠️ Account deletion setup failed; deletion requests are off:', error.message);
  }
}

module.exports = { ensureAccountDeletion, isAccountDeletionReady: () => ready };
