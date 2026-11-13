const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const { isEmailTrackingReady } = require('../utils/ensureEmailTracking');

/**
 * Open and click tracking for campaign emails.
 *
 * Every tracked link and the open pixel carry a signed token naming the
 * recipient, the campaign and (for links) the destination. The signature means
 * nobody can forge events or turn our redirect into an open redirect.
 * Recording never blocks the reader: if saving an event fails, the pixel is
 * still served and the click still lands where it should.
 *
 * Set EMAIL_TRACKING=off to send campaigns without tracking.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Mail scanners and link checkers, so they don't count as people. */
const AUTOMATED = /bot|crawler|spider|preview|scanner|headless|python|curl|wget|java\/|go-http|okhttp|barracuda|proofpoint|mimecast|symantec|forcepoint|trend ?micro|cisco|safelinks|linkchecker|urldefense/i;

const isTrackingEnabled = () => String(process.env.EMAIL_TRACKING || '').toLowerCase() !== 'off' && isEmailTrackingReady();

const secret = () => `${process.env.JWT_SECRET_KEY || 'hallos'}:email-tracking`;
const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url').slice(0, 22);

const publicBase = () =>
  (process.env.EMAIL_TRACKING_BASE_URL || process.env.EMAIL_UNSUBSCRIBE_BASE_URL || process.env.API_PUBLIC_URL || 'https://hallos-latest.onrender.com')
    .replace(/\/+$/, '');

function makeToken(parts) {
  const body = Buffer.from(JSON.stringify(parts)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  const [body, signature] = String(token || '').replace(/\.gif$/, '').split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const parts = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!UUID.test(parts.r) || !UUID.test(parts.c)) return null;
    return parts;
  } catch {
    return null;
  }
}

const decodeHtml = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const encodeHtml = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * Points every web link in the email body at the click tracker, and adds the
 * open pixel. mailto: and tel: links are left alone.
 */
function addTracking(html, { campaignId, recipientId }) {
  const tracked = String(html).replace(/href="(https?:\/\/[^"]+)"/gi, (match, rawUrl) => {
    const url = decodeHtml(rawUrl);
    const token = makeToken({ r: recipientId, c: campaignId, u: url });
    return `href="${encodeHtml(`${publicBase()}/api/email-portal/t/c/${token}`)}"`;
  });
  const pixel = `<img src="${publicBase()}/api/email-portal/t/o/${makeToken({ r: recipientId, c: campaignId })}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
  return `${tracked}${pixel}`;
}

async function record(kind, { campaignId, recipientId }, req, { url = null, detail = null, source = 'tracking' } = {}) {
  if (!isEmailTrackingReady()) return;
  try {
    await sequelize.query(
      `INSERT INTO email_events (campaign_id, recipient_id, kind, url, user_agent, ip, detail, source)
       VALUES (:campaignId, :recipientId, :kind, :url, :userAgent, :ip, :detail, :source)`,
      {
        replacements: {
          campaignId,
          recipientId,
          kind,
          url: url ? String(url).slice(0, 2000) : null,
          userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 500) || null : null,
          ip: req ? String(req.ip || '').slice(0, 64) || null : null,
          detail: detail ? String(detail).slice(0, 500) : null,
          source,
        },
      }
    );
  } catch (error) {
    console.warn(`[EmailTracking] Could not record ${kind}:`, error.message);
  }
}

/** Notes that a campaign is being sent with tracking, so its analytics are complete. */
async function markCampaignTracked(campaignId) {
  if (!isTrackingEnabled()) return;
  await sequelize
    .query('INSERT INTO email_tracked_campaigns (campaign_id) VALUES (:campaignId) ON CONFLICT DO NOTHING', {
      replacements: { campaignId },
    })
    .catch((error) => console.warn('[EmailTracking] Could not mark campaign:', error.message));
}

// --- Public endpoints -------------------------------------------------------

function handleOpen(req, res) {
  const parts = readToken(req.params.token);
  if (parts) record('open', { campaignId: parts.c, recipientId: parts.r }, req);
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
  });
  res.end(PIXEL);
}

function handleClick(req, res) {
  const parts = readToken(req.params.token);
  if (!parts || !/^https?:\/\//i.test(String(parts.u || ''))) {
    return res.status(400).send('This link is not valid.');
  }
  record('click', { campaignId: parts.c, recipientId: parts.r }, req, { url: parts.u });
  return res.redirect(302, parts.u);
}

/** The unsubscribe link carries the recipient, so unsubscribes count against the right campaign. */
async function recordUnsubscribe(recipientId, email, req) {
  if (!UUID.test(String(recipientId || '')) || !isEmailTrackingReady()) return;
  try {
    const [row] = await sequelize.query(
      'SELECT campaign_id FROM email_campaign_recipients WHERE id = :recipientId AND LOWER(email) = :email',
      { replacements: { recipientId, email: String(email).toLowerCase() }, type: QueryTypes.SELECT }
    );
    if (row) await record('unsubscribe', { campaignId: row.campaign_id, recipientId }, req);
  } catch (error) {
    console.warn('[EmailTracking] Could not attribute unsubscribe:', error.message);
  }
}

// --- Delivery webhook (Brevo) ------------------------------------------------

const BREVO_EVENTS = {
  delivered: 'delivered',
  request: null,
  sent: null,
  soft_bounce: 'soft_bounce',
  softBounce: 'soft_bounce',
  hard_bounce: 'hard_bounce',
  hardBounce: 'hard_bounce',
  invalid_email: 'hard_bounce',
  invalid: 'hard_bounce',
  blocked: 'blocked',
  spam: 'complaint',
  complaint: 'complaint',
  deferred: 'deferred',
  error: 'error',
  unsubscribed: 'unsubscribe',
};
/** These addresses should never be emailed again. */
const SUPPRESS = { hard_bounce: 'bounced', complaint: 'complaint' };

const cleanMessageId = (value) => String(value || '').trim().replace(/^<|>$/g, '');

async function handleBrevoEvent(event) {
  const kind = BREVO_EVENTS[event?.event];
  const messageId = cleanMessageId(event?.['message-id'] || event?.messageId);
  if (!kind || !messageId) return 'ignored';

  const [recipient] = await sequelize.query(
    `SELECT id, campaign_id, email FROM email_campaign_recipients
      WHERE message_id IN (:ids) LIMIT 1`,
    { replacements: { ids: [messageId, `<${messageId}>`] }, type: QueryTypes.SELECT }
  );
  if (!recipient) return 'unknown';

  await record(kind, { campaignId: recipient.campaign_id, recipientId: recipient.id }, null, {
    detail: event.reason || null,
    source: 'brevo',
  });
  if (SUPPRESS[kind]) {
    const EmailSuppression = require('../models/EmailSuppression');
    await EmailSuppression.findOrCreate({
      where: { email: String(recipient.email).trim().toLowerCase() },
      defaults: { reason: SUPPRESS[kind] },
    });
  }
  return 'recorded';
}

const webhookSecret = () => String(process.env.EMAIL_WEBHOOK_SECRET || '').trim();
const isWebhookConfigured = () => Boolean(webhookSecret());

async function handleBrevoWebhook(req, res) {
  const expected = webhookSecret();
  const given = String(req.query.secret || req.headers['x-webhook-secret'] || '');
  if (!expected) return res.status(503).json({ success: false, message: 'EMAIL_WEBHOOK_SECRET is not set' });
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.status(401).json({ success: false });
  }
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const event of events.slice(0, 500)) {
    try {
      results.push(await handleBrevoEvent(event));
    } catch (error) {
      console.warn('[EmailTracking] Webhook event failed:', error.message);
      results.push('failed');
    }
  }
  // Always 200 for a valid call, so the provider doesn't retry forever.
  return res.status(200).json({ success: true, results });
}

module.exports = {
  AUTOMATED,
  isTrackingEnabled,
  isWebhookConfigured,
  addTracking,
  markCampaignTracked,
  handleOpen,
  handleClick,
  recordUnsubscribe,
  handleBrevoWebhook,
  // For tests.
  makeToken,
  readToken,
};
