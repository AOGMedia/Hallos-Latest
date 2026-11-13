const sequelize = require('../config/db');

/**
 * Tables for the staff action log and user suspensions. Created on boot like
 * the other ensure* helpers; every statement can run again safely, and this
 * never throws. If it can't run, nothing is logged and nobody is suspended,
 * so the platform behaves exactly as it did before.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS admin_action_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id INTEGER NOT NULL,
    actor_role VARCHAR(50),
    method VARCHAR(10) NOT NULL,
    path VARCHAR(500) NOT NULL,
    status INTEGER NOT NULL,
    details JSONB,
    ip VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS admin_action_log_created ON admin_action_log (created_at DESC)',
  'CREATE INDEX IF NOT EXISTS admin_action_log_actor ON admin_action_log (actor_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS user_suspensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ends_at TIMESTAMPTZ,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lifted_at TIMESTAMPTZ,
    lifted_by INTEGER,
    lift_reason TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS user_suspensions_user ON user_suspensions (user_id, created_at DESC)',
  // At most one open suspension per person.
  'CREATE UNIQUE INDEX IF NOT EXISTS user_suspensions_one_open ON user_suspensions (user_id) WHERE lifted_at IS NULL',
  `CREATE TABLE IF NOT EXISTS content_takedowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type VARCHAR(30) NOT NULL,
    content_id VARCHAR(64) NOT NULL,
    reason TEXT NOT NULL,
    previous_state JSONB,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    restored_at TIMESTAMPTZ,
    restored_by INTEGER
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS content_takedowns_one_open ON content_takedowns (content_type, content_id) WHERE restored_at IS NULL',
  `CREATE TABLE IF NOT EXISTS content_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id INTEGER NOT NULL,
    target_type VARCHAR(30) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    reason VARCHAR(40) NOT NULL,
    details TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    resolution TEXT,
    reviewed_by INTEGER,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS content_reports_status ON content_reports (status, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS content_reports_target ON content_reports (target_type, target_id)',
  // One open report per person per item, so repeat taps don't pile up.
  "CREATE UNIQUE INDEX IF NOT EXISTS content_reports_one_open ON content_reports (reporter_id, target_type, target_id) WHERE status = 'open'",
];

let ready = false;
const isAdminFoundationsReady = () => ready;

async function ensureAdminFoundations() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    ready = true;
    console.log('✅ Staff action log, suspension, takedown and report tables ready');
    require('../services/suspensionService').startRefreshing();
    require('../services/contentModerationService').loadHidden();
  } catch (error) {
    ready = false;
    console.error('⚠️ Admin foundations setup failed; staff actions are not logged and suspensions are unavailable:', error.message);
  }
}

module.exports = { ensureAdminFoundations, isAdminFoundationsReady };
