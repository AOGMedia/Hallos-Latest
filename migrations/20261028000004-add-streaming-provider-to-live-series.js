'use strict';

/**
 * Migration: live series choose a provider (ZegoCloud or GetStream).
 *
 * VARCHAR with default 'zegocloud', so every existing series keeps using
 * ZegoCloud. IF NOT EXISTS because utils/ensureGetStreamSupport.js applies
 * the same change on server boot (Render doesn't run migrations on deploy).
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      "ALTER TABLE live_series ADD COLUMN IF NOT EXISTS streaming_provider VARCHAR(20) NOT NULL DEFAULT 'zegocloud';"
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE live_series DROP COLUMN IF EXISTS streaming_provider;'
    );
  }
};
