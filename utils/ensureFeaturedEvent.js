const sequelize = require('../config/db');

/**
 * Storage for the featured event's editable content (the /events page).
 * One row (id = 1) holding what staff changed; anything missing falls back to
 * the built-in defaults in services/featuredEventService.js, which are the
 * page as it was before this was editable. Runs on boot like the other
 * ensure* helpers: safe to repeat, never throws. If it can't run, the page
 * simply shows the defaults and registration keeps working at the default price.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS featured_event_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

let ready = false;
let registrationUserReady = false;

async function ensureFeaturedEvent() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    ready = true;
    console.log('✅ Featured event settings ready');
  } catch (error) {
    console.error('⚠️ Featured event settings setup failed; the events page uses its defaults:', error.message);
  }

  // Which account made each registration (registering needs sign-in). Nullable,
  // no default, so adding it is instant; older rows are matched by email instead.
  // Separate step: if it fails, registrations simply aren't linked.
  try {
    await sequelize.query('ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS user_id INTEGER');
    await sequelize.query('CREATE INDEX IF NOT EXISTS campaign_registrations_user_id ON campaign_registrations (user_id)');
    registrationUserReady = true;
  } catch (error) {
    console.error('⚠️ Could not link event registrations to accounts:', error.message);
  }
}

module.exports = {
  ensureFeaturedEvent,
  isFeaturedEventReady: () => ready,
  /** True once campaign_registrations.user_id exists. */
  isRegistrationUserReady: () => registrationUserReady,
};
