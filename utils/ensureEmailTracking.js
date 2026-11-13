const sequelize = require('../config/db');

/**
 * Tables for campaign opens, clicks and delivery events. Created on boot like
 * the other ensure* helpers (Render runs `node server.js` without migrations).
 * Every statement can run again safely, and this never throws: if it can't
 * run, emails still send exactly as before, just without tracking.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS email_events (
    id BIGSERIAL PRIMARY KEY,
    campaign_id UUID NOT NULL,
    recipient_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL,
    url TEXT,
    user_agent TEXT,
    ip VARCHAR(64),
    detail TEXT,
    source VARCHAR(20) NOT NULL DEFAULT 'tracking',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS email_events_campaign_kind ON email_events (campaign_id, kind, created_at)',
  'CREATE INDEX IF NOT EXISTS email_events_recipient ON email_events (recipient_id, kind)',
  `CREATE TABLE IF NOT EXISTS email_tracked_campaigns (
    campaign_id UUID PRIMARY KEY,
    tracked_since TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // Webhooks look recipients up by the provider's message id.
  'CREATE INDEX IF NOT EXISTS email_campaign_recipients_message_id ON email_campaign_recipients (message_id)',
];

let ready = false;

const isEmailTrackingReady = () => ready;

async function ensureEmailTracking() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    ready = true;
    console.log('✅ Email tracking tables ready');
  } catch (error) {
    ready = false;
    console.error('⚠️ Email tracking setup failed; campaigns still send, without open and click tracking:', error.message);
  }
}

module.exports = { ensureEmailTracking, isEmailTrackingReady };
