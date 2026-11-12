const sequelize = require('../config/db');
const {
  EMAIL_MARKETER_ROLE_NAME,
  EMAIL_MARKETER_PERMISSIONS,
} = require('../config/staffPermissions');

/**
 * Creates the staff access tables on boot. Render runs `node server.js` without
 * migrations, and every statement here is safe to repeat.
 *
 * These are separate tables with no Sequelize model on purpose: sequelize.sync()
 * never sees them and the Users table is not altered, so a problem here cannot
 * stop the server or affect a single login.
 *
 * Fail-safe: this never throws. If it can't run, staff roles stay unavailable,
 * admins are unaffected (they never touch these tables), and existing
 * email_marketer accounts keep the access their role already gives them.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS staff_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(80) NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_name_unique ON staff_roles (lower(name))`,
  `CREATE TABLE IF NOT EXISTS staff_assignments (
    user_id INTEGER PRIMARY KEY REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES staff_roles(id) ON DELETE RESTRICT,
    invite_pending BOOLEAN NOT NULL DEFAULT false,
    assigned_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS staff_assignments_role_id ON staff_assignments (role_id)`,
];

let ready = false;

const isStaffAccessReady = () => ready;

async function ensureStaffAccess() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }

    await sequelize.query(
      `INSERT INTO staff_roles (name, description, permissions, is_system)
       VALUES (:name, :description, CAST(:permissions AS jsonb), true)
       ON CONFLICT (lower(name)) DO NOTHING`,
      {
        replacements: {
          name: EMAIL_MARKETER_ROLE_NAME,
          description: 'Writes and sends email campaigns. Sees nothing else.',
          permissions: JSON.stringify(EMAIL_MARKETER_PERMISSIONS),
        },
      }
    );

    // Existing marketers appear on the Staff page and follow edits to the role.
    await sequelize.query(
      `INSERT INTO staff_assignments (user_id, role_id)
       SELECT u.id, r.id
         FROM "Users" u
         JOIN staff_roles r ON lower(r.name) = lower(:name)
        WHERE u.role = 'email_marketer'
       ON CONFLICT (user_id) DO NOTHING`,
      { replacements: { name: EMAIL_MARKETER_ROLE_NAME } }
    );

    ready = true;
    console.log('✅ Staff access tables ready');
  } catch (error) {
    ready = false;
    console.error('⚠️ Staff access setup failed; staff roles are unavailable:', error.message);
  }
}

module.exports = { ensureStaffAccess, isStaffAccessReady };
