const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const { isEmailTrackingReady } = require('../utils/ensureEmailTracking');
const { AUTOMATED, isWebhookConfigured } = require('./emailTrackingService');

/**
 * Everything we know about how one campaign landed: delivery, opens, clicks,
 * links, devices, domains, timing, unsubscribes and sales afterwards.
 *
 * Opens and clicks come from our own pixel and links. Delivery results
 * (delivered, bounced, spam, blocked) come from the mail provider's webhook.
 * Every section degrades to empty rather than failing the whole page.
 */

const CONVERSION_DAYS = 7;
/** A machine-looking user agent, matched in SQL as well as JS. */
const AUTOMATED_SQL = `(e.user_agent IS NOT NULL AND e.user_agent ~* '${AUTOMATED.source.replace(/'/g, "''")}')`;

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

async function safe(label, load, fallback) {
  try {
    return await load();
  } catch (error) {
    console.warn(`[EmailAnalytics] ${label} unavailable:`, error.message);
    return fallback;
  }
}

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Which mail app opened it, from the image request's user agent. */
function emailClient(agent) {
  const ua = String(agent || '');
  if (/GoogleImageProxy|ggpht/i.test(ua)) return 'Gmail';
  if (/YahooMailProxy/i.test(ua)) return 'Yahoo Mail';
  if (/Outlook|Microsoft Office|MSOffice|ms-office/i.test(ua)) return 'Outlook';
  if (/Thunderbird/i.test(ua)) return 'Thunderbird';
  if (/(iPhone|iPad|Macintosh).*AppleWebKit(?!.*Safari)/i.test(ua)) return 'Apple Mail';
  if (/Android/i.test(ua)) return 'Android mail app';
  if (/Chrome|Firefox|Safari|Edg/i.test(ua)) return 'Webmail in a browser';
  return 'Other';
}

/** Gmail and Yahoo fetch images through their own servers, which hides the device. */
function deviceType(agent) {
  const ua = String(agent || '');
  if (/GoogleImageProxy|YahooMailProxy|ggpht/i.test(ua)) return 'Hidden by mail provider';
  if (/iPad|Tablet/i.test(ua)) return 'Tablet';
  if (/Mobile|iPhone|Android/i.test(ua)) return 'Phone';
  if (!ua) return 'Unknown';
  return 'Computer';
}

const tally = (rows, keyOf) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row.user_agent);
    map.set(key, (map.get(key) || 0) + Number(row.people));
  }
  return [...map].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};

async function getCampaignAnalytics(campaignId) {
  const [campaign] = await select(
    `SELECT id, name, subject, status, started_at, completed_at, scheduled_for, created_at, total_recipients
       FROM email_campaigns WHERE id = :campaignId`,
    { campaignId }
  );
  if (!campaign) return null;

  const [delivery] = await select(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
            COUNT(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS pending,
            MIN(sent_at) AS first_sent, MAX(sent_at) AS last_sent
       FROM email_campaign_recipients WHERE campaign_id = :campaignId`,
    { campaignId }
  );

  const failureReasons = await safe('failure reasons', () => select(
    `SELECT COALESCE(NULLIF(error, ''), 'No reason given') AS reason, status, COUNT(*)::int AS count
       FROM email_campaign_recipients
      WHERE campaign_id = :campaignId AND status IN ('failed', 'skipped')
      GROUP BY 1, 2 ORDER BY count DESC LIMIT 10`,
    { campaignId }
  ), []);

  const tracked = isEmailTrackingReady();
  const empty = {
    tracking: { enabled: false, since: null, webhookConfigured: isWebhookConfigured(), providerEvents: 0 },
    events: {},
  };

  const tracking = tracked ? await safe('tracking', async () => {
    const [mark] = await select('SELECT tracked_since FROM email_tracked_campaigns WHERE campaign_id = :campaignId', { campaignId });
    const [provider] = await select(
      "SELECT COUNT(*)::int AS count FROM email_events WHERE campaign_id = :campaignId AND source <> 'tracking'",
      { campaignId }
    );
    return {
      enabled: Boolean(mark),
      since: mark?.tracked_since ?? null,
      webhookConfigured: isWebhookConfigured(),
      providerEvents: provider.count,
    };
  }, empty.tracking) : empty.tracking;

  // People and totals per event kind; machine opens and clicks are counted separately.
  const kinds = tracked ? await safe('events', () => select(
    `SELECT e.kind,
            COUNT(*)::int AS total,
            COUNT(DISTINCT e.recipient_id)::int AS people,
            COUNT(*) FILTER (WHERE ${AUTOMATED_SQL})::int AS automated,
            COUNT(DISTINCT e.recipient_id) FILTER (WHERE NOT ${AUTOMATED_SQL})::int AS human_people,
            COUNT(*) FILTER (WHERE NOT ${AUTOMATED_SQL})::int AS human_total
       FROM email_events e WHERE e.campaign_id = :campaignId GROUP BY e.kind`,
    { campaignId }
  ), []) : [];
  const kind = (name) => kinds.find((row) => row.kind === name) || { total: 0, people: 0, automated: 0, human_people: 0, human_total: 0 };

  const opens = kind('open');
  const clicks = kind('click');
  const delivered = kind('delivered').people;
  const hardBounces = kind('hard_bounce').people;
  const softBounces = kind('soft_bounce').people;
  const complaints = kind('complaint').people;
  const blocked = kind('blocked').people;
  const deferred = kind('deferred').people;
  const unsubscribes = kind('unsubscribe').people;

  // Someone who clicked certainly opened, even if their mail app blocked the pixel.
  const [engaged] = tracked ? await safe('engaged', () => select(
    `SELECT COUNT(DISTINCT e.recipient_id)::int AS people FROM email_events e
      WHERE e.campaign_id = :campaignId AND e.kind IN ('open', 'click') AND NOT ${AUTOMATED_SQL}`,
    { campaignId }
  ), [{ people: 0 }]) : [{ people: 0 }];

  const base = delivered > 0 ? delivered : delivery.sent;
  const uniqueOpens = engaged.people;
  const uniqueClicks = clicks.human_people;

  const [timeline, links, agents, domains, timing, topRecipients] = tracked ? await Promise.all([
    safe('timeline', () => select(
      `SELECT date_trunc('hour', e.created_at) AS bucket,
              COUNT(*) FILTER (WHERE e.kind = 'open')::int AS opens,
              COUNT(*) FILTER (WHERE e.kind = 'click')::int AS clicks
         FROM email_events e
        WHERE e.campaign_id = :campaignId AND e.kind IN ('open', 'click') AND NOT ${AUTOMATED_SQL}
        GROUP BY 1 ORDER BY 1 LIMIT 720`,
      { campaignId }
    ), []),
    safe('links', () => select(
      `SELECT e.url, COUNT(*)::int AS clicks, COUNT(DISTINCT e.recipient_id)::int AS people,
              MIN(e.created_at) AS first_click, MAX(e.created_at) AS last_click
         FROM email_events e
        WHERE e.campaign_id = :campaignId AND e.kind = 'click' AND NOT ${AUTOMATED_SQL}
        GROUP BY e.url ORDER BY clicks DESC LIMIT 50`,
      { campaignId }
    ), []),
    safe('agents', () => select(
      `SELECT first.user_agent, COUNT(*)::int AS people FROM (
         SELECT DISTINCT ON (e.recipient_id) e.recipient_id, e.user_agent
           FROM email_events e
          WHERE e.campaign_id = :campaignId AND e.kind = 'open' AND NOT ${AUTOMATED_SQL}
          ORDER BY e.recipient_id, e.created_at
       ) first GROUP BY first.user_agent`,
      { campaignId }
    ), []),
    safe('domains', () => select(
      `SELECT split_part(lower(r.email), '@', 2) AS domain,
              COUNT(*)::int AS recipients,
              COUNT(*) FILTER (WHERE r.status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events e WHERE e.recipient_id = r.id AND e.kind IN ('open', 'click') AND NOT ${AUTOMATED_SQL}))::int AS opened,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events e WHERE e.recipient_id = r.id AND e.kind = 'click' AND NOT ${AUTOMATED_SQL}))::int AS clicked,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events e WHERE e.recipient_id = r.id AND e.kind IN ('hard_bounce', 'soft_bounce', 'blocked')))::int AS bounced
         FROM email_campaign_recipients r WHERE r.campaign_id = :campaignId
        GROUP BY 1 ORDER BY recipients DESC LIMIT 12`,
      { campaignId }
    ), []),
    safe('timing', async () => (await select(
      `SELECT MIN(first_open) AS first_open,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_open - sent_at)) AS median_seconds
         FROM (
           SELECT r.sent_at, MIN(e.created_at) AS first_open
             FROM email_campaign_recipients r
             JOIN email_events e ON e.recipient_id = r.id AND e.kind IN ('open', 'click') AND NOT ${AUTOMATED_SQL}
            WHERE r.campaign_id = :campaignId AND r.sent_at IS NOT NULL
            GROUP BY r.id, r.sent_at
         ) firsts`,
      { campaignId }
    ))[0], {}),
    safe('top recipients', () => select(
      `SELECT r.id, r.user_id AS "userId", r.email, r.first_name AS "firstName", r.last_name AS "lastName",
              COUNT(*) FILTER (WHERE e.kind = 'open')::int AS opens,
              COUNT(*) FILTER (WHERE e.kind = 'click')::int AS clicks,
              MAX(e.created_at) AS "lastActivity"
         FROM email_campaign_recipients r
         JOIN email_events e ON e.recipient_id = r.id AND e.kind IN ('open', 'click') AND NOT ${AUTOMATED_SQL}
        WHERE r.campaign_id = :campaignId
        GROUP BY r.id ORDER BY clicks DESC, opens DESC LIMIT 10`,
      { campaignId }
    ), []),
  ]) : [[], [], [], [], {}, []];

  // Sales by recipients within a week of their email, with and without a click first.
  const conversions = await safe('conversions', async () => {
    const rows = await select(
      `SELECT p.currency, p.content_type AS "contentType",
              COUNT(*)::int AS purchases, COUNT(DISTINCT p.user_id)::int AS buyers,
              COALESCE(SUM(p.amount), 0)::float AS revenue,
              COUNT(*) FILTER (WHERE clicked.at IS NOT NULL)::int AS "afterClick",
              COALESCE(SUM(p.amount) FILTER (WHERE clicked.at IS NOT NULL), 0)::float AS "revenueAfterClick"
         FROM email_campaign_recipients r
         JOIN purchases p ON p.user_id = r.user_id AND p.payment_status = 'completed'
          AND p.created_at > r.sent_at AND p.created_at <= r.sent_at + INTERVAL '${CONVERSION_DAYS} days'
         LEFT JOIN LATERAL (
           ${tracked ? `SELECT MIN(e.created_at) AS at FROM email_events e
                         WHERE e.recipient_id = r.id AND e.kind = 'click' AND e.created_at <= p.created_at` : 'SELECT NULL::timestamptz AS at'}
         ) clicked ON TRUE
        WHERE r.campaign_id = :campaignId AND r.status = 'sent'
        GROUP BY p.currency, p.content_type`,
      { campaignId }
    );
    const [people] = await select(
      `SELECT COUNT(DISTINCT p.user_id)::int AS buyers
         FROM email_campaign_recipients r
         JOIN purchases p ON p.user_id = r.user_id AND p.payment_status = 'completed'
          AND p.created_at > r.sent_at AND p.created_at <= r.sent_at + INTERVAL '${CONVERSION_DAYS} days'
        WHERE r.campaign_id = :campaignId AND r.status = 'sent'`,
      { campaignId }
    );
    const byCurrency = new Map();
    for (const row of rows) {
      const current = byCurrency.get(row.currency) || { currency: row.currency, total: 0, afterClick: 0, purchases: 0 };
      current.total += row.revenue;
      current.afterClick += row.revenueAfterClick;
      current.purchases += row.purchases;
      byCurrency.set(row.currency, current);
    }
    return { windowDays: CONVERSION_DAYS, buyers: people.buyers, byCurrency: [...byCurrency.values()], byType: rows };
  }, { windowDays: CONVERSION_DAYS, buyers: 0, byCurrency: [], byType: [] });

  const duration = delivery.first_sent && delivery.last_sent
    ? (new Date(delivery.last_sent) - new Date(delivery.first_sent)) / 1000
    : null;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      status: campaign.status,
      startedAt: campaign.started_at,
      completedAt: campaign.completed_at,
    },
    tracking,
    delivery: {
      recipients: delivery.total,
      sent: delivery.sent,
      failed: delivery.failed,
      skipped: delivery.skipped,
      pending: delivery.pending,
      delivered,
      hardBounces,
      softBounces,
      blocked,
      deferred,
      complaints,
      deliveryRate: delivered > 0 ? rate(delivered, delivery.sent) : null,
      bounceRate: rate(hardBounces + softBounces + blocked, delivery.sent),
      firstSentAt: delivery.first_sent,
      lastSentAt: delivery.last_sent,
      sendDurationSeconds: duration,
      sendRatePerMinute: duration && duration > 0 ? Math.round((delivery.sent / (duration / 60)) * 10) / 10 : null,
      failureReasons,
    },
    engagement: {
      uniqueOpens,
      totalOpens: opens.human_total,
      uniqueClicks,
      totalClicks: clicks.human_total,
      automatedOpens: opens.automated,
      automatedClicks: clicks.automated,
      unsubscribes,
      complaints,
      openRate: rate(uniqueOpens, base),
      clickRate: rate(uniqueClicks, base),
      clickToOpenRate: rate(uniqueClicks, uniqueOpens),
      unsubscribeRate: rate(unsubscribes, base),
      complaintRate: rate(complaints, base),
      firstOpenAt: timing.first_open ?? null,
      medianSecondsToOpen: timing.median_seconds === null || timing.median_seconds === undefined ? null : Math.round(timing.median_seconds),
    },
    timeline: timeline.map((row) => ({ at: row.bucket, opens: row.opens, clicks: row.clicks })),
    links: links.map((row) => ({
      url: row.url,
      clicks: row.clicks,
      people: row.people,
      share: rate(row.clicks, clicks.human_total),
      firstClick: row.first_click,
      lastClick: row.last_click,
    })),
    clients: tally(agents, emailClient),
    devices: tally(agents, deviceType),
    domains: domains.map((row) => ({ ...row, openRate: rate(row.opened, row.sent) })),
    topRecipients,
    conversions,
  };
}

/** Opens and clicks for a page of campaigns, for the list view. */
async function getEngagementFor(campaignIds) {
  if (!isEmailTrackingReady() || campaignIds.length === 0) return new Map();
  const rows = await safe('list engagement', () => select(
    `SELECT e.campaign_id,
            COUNT(DISTINCT e.recipient_id) FILTER (WHERE e.kind IN ('open', 'click'))::int AS opened,
            COUNT(DISTINCT e.recipient_id) FILTER (WHERE e.kind = 'click')::int AS clicked,
            COUNT(DISTINCT e.recipient_id) FILTER (WHERE e.kind IN ('hard_bounce', 'soft_bounce', 'blocked'))::int AS bounced,
            COUNT(DISTINCT e.recipient_id) FILTER (WHERE e.kind = 'unsubscribe')::int AS unsubscribed,
            COUNT(DISTINCT e.recipient_id) FILTER (WHERE e.kind = 'delivered')::int AS delivered
       FROM email_events e
      WHERE e.campaign_id IN (:campaignIds) AND NOT ${AUTOMATED_SQL}
      GROUP BY e.campaign_id`,
    { campaignIds }
  ), []);
  const tracked = await safe('tracked list', () => select(
    'SELECT campaign_id FROM email_tracked_campaigns WHERE campaign_id IN (:campaignIds)',
    { campaignIds }
  ), []);
  const trackedSet = new Set(tracked.map((row) => row.campaign_id));
  const map = new Map(rows.map((row) => [row.campaign_id, row]));
  return new Map(campaignIds.map((id) => [id, {
    tracked: trackedSet.has(id),
    opened: map.get(id)?.opened ?? 0,
    clicked: map.get(id)?.clicked ?? 0,
    bounced: map.get(id)?.bounced ?? 0,
    unsubscribed: map.get(id)?.unsubscribed ?? 0,
    delivered: map.get(id)?.delivered ?? 0,
  }]));
}

/** Per-recipient engagement columns and filters for the recipients table. */
const RECIPIENT_ENGAGEMENT_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE e.kind = 'open' AND NOT ${AUTOMATED_SQL})::int AS opens,
           COUNT(*) FILTER (WHERE e.kind = 'click' AND NOT ${AUTOMATED_SQL})::int AS clicks,
           MIN(e.created_at) FILTER (WHERE e.kind IN ('open', 'click') AND NOT ${AUTOMATED_SQL}) AS first_opened_at,
           MAX(e.created_at) FILTER (WHERE e.kind IN ('open', 'click') AND NOT ${AUTOMATED_SQL}) AS last_activity_at,
           BOOL_OR(e.kind = 'delivered') AS delivered,
           BOOL_OR(e.kind IN ('hard_bounce', 'soft_bounce', 'blocked')) AS bounced,
           BOOL_OR(e.kind = 'complaint') AS complained,
           BOOL_OR(e.kind = 'unsubscribe') AS unsubscribed
      FROM email_events e WHERE e.recipient_id = email_campaign_recipients.id
  ) eng ON TRUE`;

const ENGAGEMENT_FILTERS = {
  opened: '(eng.opens > 0 OR eng.clicks > 0)',
  not_opened: "(status = 'sent' AND COALESCE(eng.opens, 0) = 0 AND COALESCE(eng.clicks, 0) = 0)",
  clicked: 'eng.clicks > 0',
  bounced: 'eng.bounced',
  complained: 'eng.complained',
  unsubscribed: 'eng.unsubscribed',
};

module.exports = {
  getCampaignAnalytics,
  getEngagementFor,
  RECIPIENT_ENGAGEMENT_JOIN,
  ENGAGEMENT_FILTERS,
  // For tests.
  emailClient,
  deviceType,
};
