const sequelize = require('../config/db');
const EmailCampaign = require('../models/EmailCampaign');
const campaignService = require('./emailCampaignService');
const { sendCampaignMail } = require('./emailCampaignMailer');
const { renderCampaignEmail } = require('../utils/campaignEmail');

const TICK_MS = 10 * 1000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MINUTES = 5;
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;
const OUTAGE_PAUSE_MS = 5 * 60 * 1000;
const OUTAGE_CODES = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'EAUTH'];

const sendDelayMs = () => parseInt(process.env.EMAIL_CAMPAIGN_DELAY_MS, 10) || 1500;

let timer = null;
let running = false;
let pausedUntil = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** rate_limit and outage pause the whole worker; permanent fails one recipient; transient retries it. */
const classifyError = (error) => {
  const text = `${error.response || ''} ${error.message || ''}`;
  const code = error.responseCode;
  if (/rate|limit|quota|too many|exceed/i.test(text) && (!code || code >= 400)) return 'rate_limit';
  if (OUTAGE_CODES.includes(error.code)) return 'outage';
  if (code >= 500 || error.code === 'EENVELOPE' || error.code === 'EMESSAGE') return 'permanent';
  return 'transient';
};

const truncate = (text, length = 500) => String(text || '').slice(0, length);

const query = (sql, replacements) => sequelize.query(sql, { replacements });

const promoteScheduled = () =>
  query(
    `UPDATE email_campaigns SET status = 'sending', started_at = NOW(), updated_at = NOW()
     WHERE status = 'scheduled' AND scheduled_for <= NOW()`
  );

const recoverStuck = () =>
  query(
    `UPDATE email_campaign_recipients SET status = 'pending', updated_at = NOW()
     WHERE status = 'sending' AND updated_at < NOW() - (:minutes || ' minutes')::interval`,
    { minutes: String(STUCK_AFTER_MINUTES) }
  );

const claimBatch = async (campaignId, size) => {
  const [rows] = await query(
    `UPDATE email_campaign_recipients SET status = 'sending', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM email_campaign_recipients
       WHERE campaign_id = :campaignId AND status = 'pending'
       ORDER BY created_at, id LIMIT :size FOR UPDATE SKIP LOCKED
     )
     RETURNING id, email, attempts, user_id AS "userId", first_name AS "firstName", last_name AS "lastName"`,
    { campaignId, size }
  );
  return rows;
};

const getSuppressed = async (emails) => {
  if (!emails.length) return new Set();
  const [rows] = await query('SELECT email FROM email_suppressions WHERE email IN (:emails)', { emails });
  return new Set(rows.map((r) => r.email));
};

const markRecipient = (id, fields) => {
  const sets = Object.keys(fields).map((key) => `${key} = :${key}`).join(', ');
  return query(`UPDATE email_campaign_recipients SET ${sets}, updated_at = NOW() WHERE id = :id`, { id, ...fields });
};

const requeue = (ids) =>
  ids.length
    ? query(`UPDATE email_campaign_recipients SET status = 'pending', updated_at = NOW() WHERE id IN (:ids)`, { ids })
    : Promise.resolve();

const finalizeIfDone = async (campaignId) => {
  await query(
    `UPDATE email_campaigns SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = :campaignId AND status = 'sending'
       AND NOT EXISTS (SELECT 1 FROM email_campaign_recipients
                       WHERE campaign_id = :campaignId AND status IN ('pending', 'sending'))`,
    { campaignId }
  );
};

const campaignIsSending = async (campaignId) => {
  const campaign = await EmailCampaign.findByPk(campaignId, { attributes: ['status'] });
  return Boolean(campaign) && campaign.status === 'sending';
};

const processBatch = async (campaign, batch) => {
  const suppressed = await getSuppressed(batch.map((r) => r.email));

  for (let i = 0; i < batch.length; i += 1) {
    const recipient = batch[i];

    if (!(await campaignIsSending(campaign.id))) {
      await requeue(batch.slice(i).map((r) => r.id));
      return;
    }

    if (suppressed.has(recipient.email)) {
      await markRecipient(recipient.id, { status: 'skipped', error: 'Unsubscribed' });
      continue;
    }

    try {
      const rendered = renderCampaignEmail(campaign, recipient);
      const info = await sendCampaignMail({ to: recipient.email, ...rendered, recipientId: recipient.id });
      if (info.rejected && info.rejected.length) {
        throw Object.assign(new Error(`Address rejected by mail server: ${info.rejected.join(', ')}`), { code: 'EENVELOPE' });
      }
      await markRecipient(recipient.id, {
        status: 'sent',
        sent_at: new Date(),
        message_id: truncate(info.messageId, 255),
        attempts: recipient.attempts + 1,
        error: null
      });
    } catch (error) {
      const kind = classifyError(error);

      if (kind === 'rate_limit' || kind === 'outage') {
        pausedUntil = Date.now() + (kind === 'rate_limit' ? RATE_LIMIT_PAUSE_MS : OUTAGE_PAUSE_MS);
        console.warn(`[EmailCampaign] ${kind} from mail server, pausing sends until ${new Date(pausedUntil).toISOString()}: ${error.message}`);
        await requeue(batch.slice(i).map((r) => r.id));
        return;
      }

      const attempts = recipient.attempts + 1;
      if (kind === 'permanent' || attempts >= MAX_ATTEMPTS) {
        await markRecipient(recipient.id, { status: 'failed', attempts, error: truncate(error.message) });
      } else {
        await markRecipient(recipient.id, { status: 'pending', attempts, error: truncate(error.message) });
      }
    }

    await sleep(sendDelayMs());
  }
};

const tick = async () => {
  if (running || Date.now() < pausedUntil) return;
  running = true;
  try {
    await promoteScheduled();
    await recoverStuck();

    const campaign = await EmailCampaign.findOne({ where: { status: 'sending' }, order: [['startedAt', 'ASC']] });
    if (!campaign) return;

    const capacity = await campaignService.getSendCapacity();
    if (capacity.remaining <= 0) return;

    const batch = await claimBatch(campaign.id, Math.min(BATCH_SIZE, capacity.remaining));
    if (!batch.length) {
      await finalizeIfDone(campaign.id);
      return;
    }

    await processBatch(campaign, batch);
    await finalizeIfDone(campaign.id);
  } catch (error) {
    console.error('[EmailCampaign] Worker tick failed:', error.message);
  } finally {
    running = false;
  }
};

const start = () => {
  if (timer) return;
  if (String(process.env.EMAIL_CAMPAIGN_WORKER).toLowerCase() === 'off') {
    console.log('[EmailCampaign] Worker disabled via EMAIL_CAMPAIGN_WORKER=off');
    return;
  }
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  console.log(`✅ Email campaign worker started (tick ${TICK_MS / 1000}s, limits ${JSON.stringify(campaignService.getLimits())})`);
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { start, stop, tick, classifyError };
