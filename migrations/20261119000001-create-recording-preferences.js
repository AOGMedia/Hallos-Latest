'use strict';

/**
 * Creators' saved GetStream recording settings. The server also creates this
 * on boot (utils/ensureRecordingPreferences.js), so this is safe to run either
 * way.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS recording_preferences (
      user_id INTEGER PRIMARY KEY,
      settings JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS recording_preferences');
  }
};
