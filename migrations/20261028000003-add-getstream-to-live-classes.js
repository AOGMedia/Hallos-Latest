'use strict';

/**
 * Migration: GetStream as a second live class provider.
 *
 * Adds 'getstream' to the streaming_provider enum and a getstream_call_id
 * column holding the class's current GetStream call. Every statement is
 * IF NOT EXISTS because utils/ensureGetStreamSupport.js applies the same
 * change on server boot (Render doesn't run migrations on deploy).
 *
 * Postgres can't remove a value from an enum, so `down` only drops the
 * column; the extra enum value is harmless.
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_live_classes_streaming_provider" ADD VALUE IF NOT EXISTS 'getstream';`
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS getstream_call_id VARCHAR(64);'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE live_classes DROP COLUMN IF EXISTS getstream_call_id;'
    );
  }
};
