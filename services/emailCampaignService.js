const sequelize = require('../config/db');
const EmailCampaign = require('../models/EmailCampaign');
const EmailCampaignRecipient = require('../models/EmailCampaignRecipient');
const EmailSuppression = require('../models/EmailSuppression');
const audienceService = require('./emailAudienceService');
const { sendCampaignMail } = require('./emailCampaignMailer');
const { sanitizeCampaignHtml, renderCampaignEmail } = require('../utils/campaignEmail');

const MAX_BODY_BYTES = 200 * 1024;
const MAX_TEST_RECIPIENTS = 3;
const TEST_LIMIT_PER_HOUR = 20;
const INSERT_CHUNK = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR_MS = 60 * 60 * 1000;
const LAGOS_OFFSET_MS = HOUR_MS;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const getLimits = () => ({
  hourlyCap: parseInt(process.env.EMAIL_CAMPAIGN_HOURLY_CAP, 10) || 300,
  dailyCap: parseInt(process.env.EMAIL_CAMPAIGN_DAILY_CAP, 10) || 2000
});

const startOfLagosDay = (now = new Date()) => {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - LAGOS_OFFSET_MS);
};

const countSentSince = async (since) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*)::int AS n FROM email_campaign_recipients WHERE status = 'sent' AND sent_at >= :since`,
    { replacements: { since }, type: sequelize.QueryTypes.SELECT }
  );
  return row.n;
};

/** How many more campaign emails may go out right now under the hourly and daily caps. */
const getSendCapacity = async (now = new Date()) => {
  const { hourlyCap, dailyCap } = getLimits();
  const [sentLastHour, sentToday] = await Promise.all([
    countSentSince(new Date(now.getTime() - HOUR_MS)),
    countSentSince(startOfLagosDay(now))
  ]);
  return {
    hourlyCap,
    dailyCap,
    sentLastHour,
    sentToday,
    remaining: Math.max(Math.min(hourlyCap - sentLastHour, dailyCap - sentToday), 0)
  };
};

const cleanPayload = (payload = {}) => {
  const name = String(payload.name || '').trim();
  const subject = String(payload.subject || '').replace(/[\r\n]+/g, ' ').trim();
  const preheader = String(payload.preheader || '').replace(/[\r\n]+/g, ' ').trim();
  const rawBody = String(payload.bodyHtml || '');

  if (!name) throw httpError(400, 'Campaign name is required');
  if (name.length > 150) throw httpError(400, 'Campaign name must be 150 characters or fewer');
  if (!subject) throw httpError(400, 'Subject line is required');
  if (subject.length > 200) throw httpError(400, 'Subject line must be 200 characters or fewer');
  if (preheader.length > 200) throw httpError(400, 'Preview text must be 200 characters or fewer');
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) throw httpError(400, 'Email body is too large (200KB max)');

  const bodyHtml = sanitizeCampaignHtml(rawBody);
  if (!bodyHtml.replace(/<[^>]*>/g, '').trim()) throw httpError(400, 'Email body cannot be empty');

  return {
    name,
    subject,
    preheader: preheader || null,
    bodyHtml,
    audience: audienceService.normalizeAudience(payload.audience)
  };
};

const mapCampaign = (row) => ({
  id: row.id,
  name: row.name,
  subject: row.subject,
  preheader: row.preheader,
  bodyHtml: row.body_html ?? row.bodyHtml,
  audience: row.audience,
  status: row.status,
  scheduledFor: row.scheduled_for ?? row.scheduledFor ?? null,
  startedAt: row.started_at ?? row.startedAt ?? null,
  completedAt: row.completed_at ?? row.completedAt ?? null,
  totalRecipients: row.total_recipients ?? row.totalRecipients ?? 0,
  createdBy: row.created_by ?? row.createdBy ?? null,
  createdByName: row.created_by_name ?? null,
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt,
  counts: {
    pending: row.pending_count ?? 0,
    sent: row.sent_count ?? 0,
    failed: row.failed_count ?? 0,
    skipped: row.skipped_count ?? 0
  }
});

const COUNT_COLUMNS = `
  COALESCE(r.pending_count, 0)::int AS pending_count,
  COALESCE(r.sent_count, 0)::int AS sent_count,
  COALESCE(r.failed_count, 0)::int AS failed_count,
  COALESCE(r.skipped_count, 0)::int AS skipped_count`;

const COUNT_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) AS pending_count,
           COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
           COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_count
    FROM email_campaign_recipients WHERE campaign_id = c.id
  ) r ON TRUE
  LEFT JOIN "Users" creator ON creator.id = c.created_by`;

const select = (sql, replacements) =>
  sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

const findCampaignOrThrow = async (id, options = {}) => {
  const campaign = await EmailCampaign.findByPk(id, options);
  if (!campaign) throw httpError(404, 'Campaign not found');
  return campaign;
};

const createCampaign = async (userId, payload) => {
  const data = cleanPayload(payload);
  const campaign = await EmailCampaign.create({ ...data, createdBy: userId });
  return getCampaign(campaign.id);
};

const updateCampaign = async (id, payload) => {
  const campaign = await findCampaignOrThrow(id);
  if (campaign.status !== 'draft') throw httpError(409, 'Only draft campaigns can be edited');
  await campaign.update(cleanPayload(payload));
  return getCampaign(id);
};

const deleteCampaign = async (id) => {
  const campaign = await findCampaignOrThrow(id);
  if (!['draft', 'cancelled'].includes(campaign.status)) {
    throw httpError(409, 'Only draft or cancelled campaigns can be deleted');
  }
  await campaign.destroy();
};

const getCampaign = async (id) => {
  const [row] = await select(
    `SELECT c.*, ${COUNT_COLUMNS},
            NULLIF(TRIM(CONCAT(creator.firstname, ' ', creator.lastname)), '') AS created_by_name
     FROM email_campaigns c ${COUNT_JOIN} WHERE c.id = :id`,
    { id }
  );
  if (!row) throw httpError(404, 'Campaign not found');
  return mapCampaign(row);
};

const listCampaigns = async ({ page = 1, limit = 20, status, search } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const clauses = ['TRUE'];
  const replacements = { limit: safeLimit, offset: (safePage - 1) * safeLimit };

  if (status && EmailCampaign.STATUSES.includes(status)) {
    clauses.push('c.status = :status');
    replacements.status = status;
  }
  const term = String(search || '').trim().slice(0, 100);
  if (term) {
    clauses.push('(c.name ILIKE :search OR c.subject ILIKE :search)');
    replacements.search = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
  }

  const whereSql = clauses.join(' AND ');
  const [{ total }] = await select(`SELECT COUNT(*)::int AS total FROM email_campaigns c WHERE ${whereSql}`, replacements);
  const rows = await select(
    `SELECT c.*, ${COUNT_COLUMNS},
            NULLIF(TRIM(CONCAT(creator.firstname, ' ', creator.lastname)), '') AS created_by_name
     FROM email_campaigns c ${COUNT_JOIN}
     WHERE ${whereSql} ORDER BY c.created_at DESC LIMIT :limit OFFSET :offset`,
    replacements
  );

  return {
    campaigns: rows.map((row) => {
      const mapped = mapCampaign(row);
      delete mapped.bodyHtml;
      return mapped;
    }),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(Math.ceil(total / safeLimit), 1)
  };
};

const listRecipients = async (campaignId, { status, search, page = 1, limit = 50 } = {}) => {
  await findCampaignOrThrow(campaignId);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const clauses = ['campaign_id = :campaignId'];
  const replacements = { campaignId, limit: safeLimit, offset: (safePage - 1) * safeLimit };

  if (status && EmailCampaignRecipient.STATUSES.includes(status)) {
    clauses.push('status = :status');
    replacements.status = status;
  }
  const term = String(search || '').trim().slice(0, 100);
  if (term) {
    clauses.push("(email ILIKE :search OR CONCAT(first_name, ' ', last_name) ILIKE :search)");
    replacements.search = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
  }

  const whereSql = clauses.join(' AND ');
  const [{ total }] = await select(`SELECT COUNT(*)::int AS total FROM email_campaign_recipients WHERE ${whereSql}`, replacements);
  const rows = await select(
    `SELECT id, user_id AS "userId", email, first_name AS "firstName", last_name AS "lastName", status,
            attempts, error, sent_at AS "sentAt", updated_at AS "updatedAt"
     FROM email_campaign_recipients WHERE ${whereSql}
     ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'sending' THEN 1 WHEN 'pending' THEN 2 WHEN 'sent' THEN 3 ELSE 4 END,
              sent_at DESC NULLS LAST, email
     LIMIT :limit OFFSET :offset`,
    replacements
  );

  return { recipients: rows, total, page: safePage, limit: safeLimit, totalPages: Math.max(Math.ceil(total / safeLimit), 1) };
};

const sendCampaign = async (id, userId, { scheduledFor } = {}) => {
  const existing = await findCampaignOrThrow(id);
  if (existing.status !== 'draft') throw httpError(409, `This campaign is already ${existing.status}`);

  const recipients = await audienceService.resolveAudience(existing.audience);
  if (!recipients.length) throw httpError(400, 'No users match this audience, so there is nobody to send to');

  let scheduleDate = null;
  if (scheduledFor) {
    scheduleDate = new Date(scheduledFor);
    if (Number.isNaN(scheduleDate.getTime())) throw httpError(400, 'Invalid schedule date');
    if (scheduleDate.getTime() > Date.now() + 90 * 24 * HOUR_MS) throw httpError(400, 'Schedule date is too far in the future');
  }
  const isScheduled = scheduleDate && scheduleDate.getTime() > Date.now() + 60 * 1000;

  await sequelize.transaction(async (transaction) => {
    const campaign = await EmailCampaign.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (campaign.status !== 'draft') throw httpError(409, `This campaign is already ${campaign.status}`);

    for (let i = 0; i < recipients.length; i += INSERT_CHUNK) {
      await EmailCampaignRecipient.bulkCreate(
        recipients.slice(i, i + INSERT_CHUNK).map((r) => ({
          campaignId: id,
          userId: r.id,
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName
        })),
        { transaction, ignoreDuplicates: true }
      );
    }

    await campaign.update(
      {
        status: isScheduled ? 'scheduled' : 'sending',
        scheduledFor: isScheduled ? scheduleDate : null,
        startedAt: isScheduled ? null : new Date(),
        totalRecipients: recipients.length
      },
      { transaction }
    );
  });

  const { hourlyCap, dailyCap } = getLimits();
  const perHour = Math.min(hourlyCap, dailyCap);
  return {
    campaign: await getCampaign(id),
    estimate: {
      recipients: recipients.length,
      hourlyCap,
      dailyCap,
      estimatedHours: Math.ceil(recipients.length / perHour),
      estimatedDays: Math.ceil(recipients.length / dailyCap)
    }
  };
};

const cancelCampaign = async (id) => {
  const campaign = await findCampaignOrThrow(id);
  if (!['scheduled', 'sending'].includes(campaign.status)) {
    throw httpError(409, 'Only scheduled or sending campaigns can be cancelled');
  }
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `UPDATE email_campaign_recipients SET status = 'skipped', error = 'Campaign cancelled', updated_at = NOW()
       WHERE campaign_id = :id AND status = 'pending'`,
      { replacements: { id }, transaction }
    );
    await campaign.update({ status: 'cancelled', completedAt: new Date() }, { transaction });
  });
  return getCampaign(id);
};

const retryFailed = async (id) => {
  const campaign = await findCampaignOrThrow(id);
  if (!['completed', 'sending'].includes(campaign.status)) {
    throw httpError(409, 'Failed emails can only be retried on sending or completed campaigns');
  }
  const [, meta] = await sequelize.query(
    `UPDATE email_campaign_recipients SET status = 'pending', attempts = 0, error = NULL, updated_at = NOW()
     WHERE campaign_id = :id AND status = 'failed'`,
    { replacements: { id } }
  );
  const retried = meta.rowCount || 0;
  if (retried > 0) await campaign.update({ status: 'sending', completedAt: null });
  return { retried, campaign: await getCampaign(id) };
};

const testSendLog = new Map();

const sendTest = async (user, { subject, preheader, bodyHtml, to }) => {
  const targets = [...new Set((Array.isArray(to) ? to : [to]).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
  if (!targets.length) throw httpError(400, 'Enter at least one email address to send the test to');
  if (targets.length > MAX_TEST_RECIPIENTS) throw httpError(400, `You can send a test to at most ${MAX_TEST_RECIPIENTS} addresses`);
  if (targets.some((e) => !EMAIL_RE.test(e))) throw httpError(400, 'One of the test email addresses is not valid');

  const now = Date.now();
  const recent = (testSendLog.get(user.id) || []).filter((t) => now - t < HOUR_MS);
  if (recent.length + targets.length > TEST_LIMIT_PER_HOUR) {
    throw httpError(429, 'Test email limit reached for this hour. Please try again later.');
  }

  const cleaned = cleanPayload({ name: 'test', subject, preheader, bodyHtml });
  const results = [];
  for (const email of targets) {
    try {
      const rendered = renderCampaignEmail(cleaned, { email, firstName: user.firstname, lastName: user.lastname });
      await sendCampaignMail({ to: email, ...rendered, subject: `[TEST] ${rendered.subject}` });
      results.push({ email, ok: true });
    } catch (error) {
      results.push({ email, ok: false, error: error.message });
    }
  }
  testSendLog.set(user.id, [...recent, ...targets.map(() => now)]);
  return results;
};

const getPortalStats = async () => {
  const capacity = await getSendCapacity();
  const [totals] = await select(
    `SELECT (SELECT COUNT(*) FROM email_campaigns)::int AS campaigns,
            (SELECT COUNT(*) FROM email_campaigns WHERE status IN ('sending', 'scheduled'))::int AS active,
            (SELECT COUNT(*) FROM email_campaign_recipients WHERE status = 'sent')::int AS "totalSent",
            (SELECT COUNT(*) FROM email_campaign_recipients WHERE status = 'failed')::int AS "totalFailed",
            (SELECT COUNT(*) FROM email_suppressions)::int AS unsubscribed`
  );
  return { ...totals, limits: capacity };
};

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const exportRecipientsCsv = async (id) => {
  const campaign = await findCampaignOrThrow(id);
  const rows = await select(
    `SELECT email, first_name, last_name, status, attempts, error, sent_at
     FROM email_campaign_recipients WHERE campaign_id = :id ORDER BY email`,
    { id }
  );
  const lines = ['email,first_name,last_name,status,attempts,error,sent_at'];
  for (const r of rows) {
    lines.push([r.email, r.first_name, r.last_name, r.status, r.attempts, r.error, r.sent_at && new Date(r.sent_at).toISOString()].map(csvCell).join(','));
  }
  return { filename: `${campaign.name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'campaign'}-recipients.csv`, csv: lines.join('\n') };
};

const addSuppression = async (email, reason = 'unsubscribed') => {
  await EmailSuppression.findOrCreate({ where: { email: String(email).trim().toLowerCase() }, defaults: { reason } });
};

module.exports = {
  getLimits,
  getSendCapacity,
  cleanPayload,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  listRecipients,
  sendCampaign,
  cancelCampaign,
  retryFailed,
  sendTest,
  getPortalStats,
  exportRecipientsCsv,
  addSuppression,
  httpError
};
