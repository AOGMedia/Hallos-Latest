'use strict';

/**
 * Migration: live_session_hosts — co-hosts the creator added during a GetStream
 * series session. sequelize.sync also creates it on boot (Render doesn't run
 * migrations), so every statement tolerates the table already existing.
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS live_session_hosts (
        id UUID PRIMARY KEY,
        session_id UUID NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS live_session_hosts_session_user_unique ON live_session_hosts (session_id, user_id);'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS live_session_hosts;');
  }
};
