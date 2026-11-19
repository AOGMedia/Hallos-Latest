const sequelize = require('../config/db');

/**
 * Each creator's saved recording settings for GetStream classes (quality,
 * layout, look, auto-record). One row per creator. Created on boot like the
 * other ensure* helpers: safe to repeat, never throws. Until it's ready,
 * recordings simply use the standard settings, exactly as before.
 */
let ready = false;

async function ensureRecordingPreferences() {
  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS recording_preferences (
      user_id INTEGER PRIMARY KEY,
      settings JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    ready = true;
    console.log('✅ Recording preferences ready');
  } catch (error) {
    console.error('⚠️ Recording preferences setup failed; recordings use the standard settings:', error.message);
  }
}

module.exports = { ensureRecordingPreferences, isRecordingPreferencesReady: () => ready };
