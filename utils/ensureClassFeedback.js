const sequelize = require('../config/db');

/**
 * Feedback after live classes and series sessions (both providers). One row
 * per person per class/session — hosts and participants alike. Created on
 * boot like the other ensure* helpers: safe to repeat, never throws. Until
 * it's ready, the feedback page says it can't take answers right now.
 */
let ready = false;

async function ensureClassFeedback() {
  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS class_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      target_kind VARCHAR(10) NOT NULL,
      target_id UUID NOT NULL,
      user_id INTEGER NOT NULL,
      role VARCHAR(12) NOT NULL,
      overall SMALLINT NOT NULL,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      comment TEXT,
      anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS class_feedback_one_per_person ON class_feedback (target_kind, target_id, user_id)'
    );
    await sequelize.query('CREATE INDEX IF NOT EXISTS class_feedback_target ON class_feedback (target_kind, target_id)');

    // Who actually got into each class/session room (both providers), so
    // feedback goes to the people who were there — not everyone who paid.
    await sequelize.query(`CREATE TABLE IF NOT EXISTS live_room_attendance (
      target_kind VARCHAR(10) NOT NULL,
      target_id UUID NOT NULL,
      user_id INTEGER NOT NULL,
      role VARCHAR(12) NOT NULL,
      first_joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (target_kind, target_id, user_id)
    )`);

    // One row per ended class/session: when its feedback emails go out, and
    // that they went (claimed atomically, so they're never sent twice).
    await sequelize.query(`CREATE TABLE IF NOT EXISTS class_feedback_dispatch (
      target_kind VARCHAR(10) NOT NULL,
      target_id UUID NOT NULL,
      send_after TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ,
      sent_count INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (target_kind, target_id)
    )`);
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS class_feedback_dispatch_due ON class_feedback_dispatch (send_after) WHERE claimed_at IS NULL'
    );
    ready = true;
    console.log('✅ Class feedback ready');
  } catch (error) {
    console.error('⚠️ Class feedback setup failed; feedback can’t be taken until it works:', error.message);
  }
}

module.exports = { ensureClassFeedback, isClassFeedbackReady: () => ready };
