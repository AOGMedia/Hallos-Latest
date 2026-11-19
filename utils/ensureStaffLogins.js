const sequelize = require('../config/db');

/**
 * Staff logins created by a super admin (an email and a generated password,
 * used only in the admin app), and ending a staff member's sessions.
 *
 * Adds columns to staff_assignments. Each is nullable or has a constant
 * default, so adding it is instant on a live table. Runs on boot after the
 * staff tables exist, can run again safely, and never throws: if it can't run,
 * staff roles work exactly as before, without these logins.
 */
const STATEMENTS = [
  // Made by a super admin for staff work only: can't sign in to the site or the app.
  'ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT false',
  // Turned off by a super admin: can't sign in, and current sessions end.
  'ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ',
  // Sign-ins from before this moment no longer work (password reset, turned off).
  'ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ',
  'ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ',
];

let ready = false;

async function ensureStaffLogins() {
  if (!require('./ensureStaffAccess').isStaffAccessReady()) {
    console.error('⚠️ Staff logins skipped: staff tables aren’t ready.');
    return;
  }
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    ready = true;
    console.log('✅ Staff logins ready');
    require('../services/staffLoginService').startRefreshing();
  } catch (error) {
    console.error('⚠️ Staff logins setup failed; staff roles work as before, without created logins:', error.message);
  }
}

module.exports = { ensureStaffLogins, isStaffLoginsReady: () => ready };
