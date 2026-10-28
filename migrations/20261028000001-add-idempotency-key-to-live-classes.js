'use strict';

/**
 * Migration: Add idempotency_key to live_classes
 *
 * Survives-bad-network fix for live class creation. The create request is a
 * multipart upload (thumbnail) that can outlast the client's timeout while
 * still succeeding on the server, and the only thing a user can do on that
 * error is retry — which created a duplicate live class. The client now sends
 * one key per form session on every attempt; the controller returns the
 * existing row for a repeated key instead of inserting a second one.
 *
 * Nullable, unique only where set (partial index): existing rows and callers
 * that don't send a key are unaffected.
 *
 * Every statement is IF NOT EXISTS because utils/ensureLiveIdempotency.js
 * applies the same change on server boot (Render doesn't run migrations on
 * deploy). Running this afterwards is a no-op rather than an error.
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);'
    );
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_live_classes_idempotency_key_unique ' +
      'ON live_classes (idempotency_key) WHERE idempotency_key IS NOT NULL;'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS idx_live_classes_idempotency_key_unique;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE live_classes DROP COLUMN IF EXISTS idempotency_key;'
    );
  }
};
