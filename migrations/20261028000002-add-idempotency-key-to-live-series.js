'use strict';

/**
 * Migration: Add idempotency_key to live_series
 *
 * Same fix and reasoning as 20261028000001-add-idempotency-key-to-live-classes.js.
 * A duplicated series is worse than a duplicated class: each copy generates its
 * own full set of sessions on the schedule.
 *
 * IF NOT EXISTS throughout — utils/ensureLiveIdempotency.js applies the same
 * change on server boot.
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE live_series ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);'
    );
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_live_series_idempotency_key_unique ' +
      'ON live_series (idempotency_key) WHERE idempotency_key IS NOT NULL;'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS idx_live_series_idempotency_key_unique;'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE live_series DROP COLUMN IF EXISTS idempotency_key;'
    );
  }
};
