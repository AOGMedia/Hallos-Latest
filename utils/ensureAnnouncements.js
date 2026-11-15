const sequelize = require('../config/db');

/**
 * Storage for in-app announcements (banners on the site and in the app).
 * Runs on boot like the other ensure* helpers: safe to repeat, never throws.
 * If it can't run, no banners show — nothing else changes.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(120) NOT NULL,
    body TEXT,
    link_url VARCHAR(500),
    link_label VARCHAR(40),
    tone VARCHAR(20) NOT NULL DEFAULT 'info',
    audience VARCHAR(20) NOT NULL DEFAULT 'everyone',
    show_on_web BOOLEAN NOT NULL DEFAULT TRUE,
    show_in_app BOOLEAN NOT NULL DEFAULT TRUE,
    dismissible BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMPTZ,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS announcements_window ON announcements (starts_at, ends_at)',
];

async function ensureAnnouncements() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    require('../services/announcementService').start();
    console.log('✅ Announcements ready');
  } catch (error) {
    console.error('⚠️ Announcements setup failed; no banners will show:', error.message);
  }
}

module.exports = { ensureAnnouncements };
