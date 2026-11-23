const sequelize = require('../config/db');

/**
 * Video drafts: a video whose file is uploading (or uploaded) but whose
 * creator hasn't pressed Publish yet. The video row itself is a normal
 * `videos` row kept private; this table only marks it as a draft, so no
 * existing column or query changes. Created on boot like the other ensure*
 * helpers: safe to repeat, never throws. Until it's ready the website falls
 * back to the classic "upload when you publish" flow.
 */
let ready = false;

async function ensureVideoDrafts() {
  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS video_drafts (
      video_id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL,
      file_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await sequelize.query('CREATE INDEX IF NOT EXISTS video_drafts_user ON video_drafts (user_id)');
    ready = true;
    console.log('✅ Video drafts ready');
  } catch (error) {
    console.error('⚠️ Video drafts setup failed; uploads use the classic flow until it works:', error.message);
  }
}

module.exports = { ensureVideoDrafts, isVideoDraftsReady: () => ready };
