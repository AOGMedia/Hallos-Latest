'use strict';

/**
 * Migration: pending_signups — sign-ups waiting for their email code. The
 * users table is not changed. sequelize.sync also creates it on boot (Render
 * doesn't run migrations), so every statement tolerates the table existing.
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS pending_signups (
        id UUID PRIMARY KEY,
        email_key VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        firstname VARCHAR(255) NOT NULL,
        lastname VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        code_hash VARCHAR(128) NOT NULL,
        code_expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        send_count INTEGER NOT NULL DEFAULT 1,
        last_sent_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        referral_code VARCHAR(100),
        quiz_invite_token VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS pending_signups_email_key_unique ON pending_signups (email_key);'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS pending_signups_expires_idx ON pending_signups (expires_at);'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS pending_signups;');
  }
};
