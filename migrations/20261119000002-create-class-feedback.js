'use strict';

/**
 * Feedback after live classes and series sessions. The server also creates
 * this on boot (utils/ensureClassFeedback.js), so this is safe to run either way.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS class_feedback (
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
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS class_feedback_one_per_person ON class_feedback (target_kind, target_id, user_id)'
    );
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS class_feedback_target ON class_feedback (target_kind, target_id)');
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS live_room_attendance (
      target_kind VARCHAR(10) NOT NULL,
      target_id UUID NOT NULL,
      user_id INTEGER NOT NULL,
      role VARCHAR(12) NOT NULL,
      first_joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (target_kind, target_id, user_id)
    )`);
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS class_feedback_dispatch (
      target_kind VARCHAR(10) NOT NULL,
      target_id UUID NOT NULL,
      send_after TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ,
      sent_count INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (target_kind, target_id)
    )`);
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS class_feedback_dispatch_due ON class_feedback_dispatch (send_after) WHERE claimed_at IS NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS class_feedback_dispatch');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS live_room_attendance');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS class_feedback');
  }
};
