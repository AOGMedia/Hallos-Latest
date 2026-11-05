'use strict';

/**
 * Migration: recording_publications — GetStream class recordings published as
 * videos. sequelize.sync also creates it on boot (Render doesn't run
 * migrations), so every statement tolerates the table already existing.
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS recording_publications (
        id UUID PRIMARY KEY,
        source_type VARCHAR(16) NOT NULL,
        source_id VARCHAR(64) NOT NULL,
        filename VARCHAR(512) NOT NULL,
        video_id UUID NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS recording_publications_source_file_unique ON recording_publications (source_type, source_id, filename);'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS recording_publications_video_idx ON recording_publications (video_id);'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS recording_publications;');
  }
};
