'use strict';

/**
 * Migration: live_gifts — gifts sent to hosts during GetStream live classes
 * and series sessions. sequelize.sync also creates it on boot (Render doesn't
 * run migrations), so every statement tolerates the table already existing.
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS live_gifts (
        id UUID PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        content_type VARCHAR(20) NOT NULL,
        content_id UUID NOT NULL,
        gift_code VARCHAR(32) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        amount BIGINT NOT NULL,
        host_amount BIGINT NOT NULL,
        platform_fee BIGINT NOT NULL,
        idempotency_key VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS live_gifts_sender_idempotency_unique ON live_gifts (sender_id, idempotency_key);'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS live_gifts_content_idx ON live_gifts (content_type, content_id);'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS live_gifts_recipient_idx ON live_gifts (recipient_id);'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS live_gifts;');
  }
};
