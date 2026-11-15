const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Email alerts to staff, sent the moment something happens (no background
 * jobs, no polling).
 *
 * - Off by default: each staff member turns on the alerts they want (admin →
 *   Email alerts). They only get alerts their role lets them act on.
 * - Quiet period: at most one email per alert per person every
 *   QUIET_MINUTES. Anything in between is counted and mentioned in the next
 *   email ("and 3 more since your last alert"), so a busy hour never floods
 *   anyone's inbox.
 * - Never slows or breaks the action that triggered it: `notify` returns at
 *   once, does its work afterwards, and swallows every error (logged).
 */
const QUIET_MINUTES = 15;

/** Every alert: who may get it, and how it reads. */
const ALERTS = {
  'reports.new': {
    label: 'Someone reports content or a person',
    description: 'A user flagged a video, freebie, live class, community or person.',
    permission: 'reports.view',
    path: '/reports',
    action: 'Open reports',
  },
  'accounts.deletion_requested': {
    label: 'Someone asks to delete their account',
    description: 'They have 14 days to change their mind before it can be deleted.',
    permission: 'users.delete',
    path: '/account-deletions',
    action: 'Open account deletions',
  },
  'payouts.failed': {
    label: 'A withdrawal fails',
    description: 'A creator’s withdrawal couldn’t be sent; their money was returned to their wallet.',
    permission: 'payouts.view',
    path: '/payouts',
    action: 'Open payouts',
  },
};

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const isReady = () => require('../utils/ensureStaffAlerts').isStaffAlertsReady();

class StaffAlertError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Settings (each staff member, for themselves) ----------

/** The alerts this person may turn on, with whether each is on. */
async function settingsFor(access, userId) {
  if (!isReady()) throw new StaffAlertError(503, 'Email alerts are unavailable right now.');
  const rows = await select('SELECT alert_key, enabled FROM staff_alert_settings WHERE user_id = :userId', { userId });
  const on = new Map(rows.map((r) => [r.alert_key, r.enabled]));
  return Object.entries(ALERTS)
    .filter(([, alert]) => access.isSuperAdmin || access.permissions.includes(alert.permission))
    .map(([key, alert]) => ({ key, label: alert.label, description: alert.description, enabled: Boolean(on.get(key)) }));
}

async function setEnabled(access, userId, key, enabled) {
  if (!isReady()) throw new StaffAlertError(503, 'Email alerts are unavailable right now.');
  const alert = ALERTS[key];
  if (!alert) throw new StaffAlertError(404, 'That alert doesn’t exist.');
  if (!access.isSuperAdmin && !access.permissions.includes(alert.permission)) {
    throw new StaffAlertError(403, 'Your role doesn’t include this alert.');
  }
  await sequelize.query(
    `INSERT INTO staff_alert_settings (user_id, alert_key, enabled, updated_at)
     VALUES (:userId, :key, :enabled, NOW())
     ON CONFLICT (user_id, alert_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    { replacements: { userId, key, enabled: Boolean(enabled) } }
  );
  return settingsFor(access, userId);
}

// ---------- Sending ----------

/** Staff who turned this alert on and whose role (still) includes it. */
async function recipients(key) {
  const alert = ALERTS[key];
  return select(
    `SELECT u.id, u.email, u.firstname
       FROM staff_alert_settings s
       JOIN "Users" u ON u.id = s.user_id
      WHERE s.alert_key = :key AND s.enabled
        AND u.email NOT LIKE '%@deleted.hallos.invalid'
        AND (
          u.role = 'admin'
          OR EXISTS (
            SELECT 1 FROM staff_assignments a JOIN staff_roles r ON r.id = a.role_id
             WHERE a.user_id = u.id AND r.permissions @> jsonb_build_array(CAST(:permission AS text))
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_suspensions x
           WHERE x.user_id = u.id AND x.lifted_at IS NULL AND (x.ends_at IS NULL OR x.ends_at > NOW())
        )`,
    { key, permission: alert.permission }
  );
}

/**
 * Who gets an email now (quiet period over) and how many they missed; the
 * rest are counted for their next email. One statement each, so two events at
 * the same moment can't both email the same person.
 */
async function claim(key, userIds) {
  if (!userIds.length) return [];
  const due = await select(
    `UPDATE staff_alert_settings s
        SET last_sent_at = NOW(), skipped = 0
       FROM (SELECT user_id, skipped FROM staff_alert_settings
              WHERE alert_key = :key AND user_id IN (:userIds) FOR UPDATE) old
      WHERE s.user_id = old.user_id AND s.alert_key = :key AND s.enabled
        AND (s.last_sent_at IS NULL OR s.last_sent_at < NOW() - make_interval(mins => :quiet))
      RETURNING s.user_id AS "userId", old.skipped AS "skipped"`,
    { key, userIds, quiet: QUIET_MINUTES }
  );
  const sent = new Set(due.map((d) => Number(d.userId)));
  const waiting = userIds.filter((id) => !sent.has(Number(id)));
  if (waiting.length) {
    await sequelize.query(
      'UPDATE staff_alert_settings SET skipped = skipped + 1 WHERE alert_key = :key AND user_id IN (:waiting) AND enabled',
      { replacements: { key, waiting } }
    );
  }
  return due;
}

const adminUrl = (path) => `${String(process.env.ADMIN_APP_URL || 'https://admin.hallos.net').replace(/\/+$/, '')}${path}`;

async function deliver(key, details) {
  if (!isReady()) return;
  const alert = ALERTS[key];
  const people = await recipients(key);
  if (!people.length) return;
  const due = await claim(key, people.map((p) => Number(p.id)));
  const byId = new Map(people.map((p) => [Number(p.id), p]));
  const { sendStaffAlertEmail } = require('../utils/email');
  await Promise.all(
    due.map(({ userId, skipped }) => {
      const person = byId.get(Number(userId));
      return sendStaffAlertEmail(person.email, person.firstname, {
        title: details.title,
        lines: details.lines || [],
        moreSince: Number(skipped) || 0,
        actionLabel: alert.action,
        actionUrl: adminUrl(details.path || alert.path),
        quietMinutes: QUIET_MINUTES,
      }).catch((error) => console.warn(`[Staff alerts] Email to staff ${userId} failed:`, error.message));
    })
  );
  if (due.length) console.log(`[Staff alerts] ${key}: emailed ${due.length}, held ${people.length - due.length}`);
}

/**
 * Raise an alert. Returns immediately; never throws.
 * @param {keyof ALERTS} key
 * @param {{ title: string, lines?: string[], path?: string }} details  (plain text; escaped in the email)
 */
function notify(key, details) {
  if (!ALERTS[key]) return;
  setImmediate(() => {
    deliver(key, details).catch((error) => console.warn(`[Staff alerts] ${key} failed:`, error.message));
  });
}

module.exports = { ALERTS, QUIET_MINUTES, StaffAlertError, settingsFor, setEnabled, notify };
