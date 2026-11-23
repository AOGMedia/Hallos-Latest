'use strict';

/** Video drafts (also created on boot by utils/ensureVideoDrafts.js). */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS video_drafts (
      video_id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL,
      file_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS video_drafts_user ON video_drafts (user_id)');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS video_drafts');
  },
};
