/**
 * In-app announcements: banners staff publish to the site and the app.
 *
 * Each has a window (starts/ends), an audience (everyone, creators, or people
 * who aren't creators) and where it shows (site, app or both). People can
 * dismiss dismissible ones; that's remembered on their device.
 *
 * The site and app ask for active banners often, so the current list is kept
 * in memory and refreshed by traffic at most every 30 seconds (no timers),
 * and immediately when staff change something.
 */
const sequelize = require('../config/db');

class AnnouncementError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TONES = ['info', 'success', 'warning'];
const AUDIENCES = ['everyone', 'creators', 'learners'];
const MAX_AGE_MS = 30 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let ready = false;
let live = []; // started and not ended, as of the last load
let loadedAt = 0;
let loading = null;

const select = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

const shape = (row) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  linkUrl: row.link_url,
  linkLabel: row.link_label,
  tone: row.tone,
  audience: row.audience,
  showOnWeb: row.show_on_web,
  showInApp: row.show_in_app,
  dismissible: row.dismissible,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
});

async function loadLive() {
  // Also loads ones starting soon, so a scheduled banner appears on time between refreshes.
  live = await select(
    `SELECT * FROM announcements
      WHERE starts_at <= NOW() + INTERVAL '1 minute' AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY starts_at DESC LIMIT 20`
  );
  loadedAt = Date.now();
}

function refreshIfStale() {
  if (!ready || loading || Date.now() - loadedAt < MAX_AGE_MS) return;
  loading = loadLive()
    .catch((error) => console.error('[Announcements] Refresh failed; keeping the last list:', error.message))
    .finally(() => { loading = null; });
}

function start() {
  ready = true;
  loadLive().catch((error) => console.error('[Announcements] First load failed:', error.message));
}

/** Banners for one person on one platform right now. Never throws. */
function activeFor({ platform, role }) {
  refreshIfStale();
  const now = Date.now();
  const isCreator = role === 'creator';
  return live
    .filter((row) => new Date(row.starts_at).getTime() <= now && (!row.ends_at || new Date(row.ends_at).getTime() > now))
    .filter((row) => (platform === 'app' ? row.show_in_app : row.show_on_web))
    .filter((row) => row.audience === 'everyone' || (row.audience === 'creators' ? isCreator : !isCreator))
    .slice(0, 3)
    .map(shape);
}

// --- Staff -----------------------------------------------------------------------------

const assertReady = () => {
  if (!ready) throw new AnnouncementError(503, 'Announcements are unavailable right now. Check the server logs.');
};

function validate(input) {
  const title = String(input.title ?? '').trim();
  if (title.length < 3 || title.length > 120) throw new AnnouncementError(400, 'Give it a title (3–120 characters).');
  const body = String(input.body ?? '').trim().slice(0, 500) || null;
  let linkUrl = String(input.linkUrl ?? '').trim() || null;
  if (linkUrl && !/^(https:\/\/|\/)/i.test(linkUrl)) throw new AnnouncementError(400, 'Links must start with https:// or /.');
  if (linkUrl && linkUrl.length > 500) linkUrl = linkUrl.slice(0, 500);
  const linkLabel = linkUrl ? String(input.linkLabel ?? '').trim().slice(0, 40) || 'Learn more' : null;
  const tone = TONES.includes(input.tone) ? input.tone : 'info';
  const audience = AUDIENCES.includes(input.audience) ? input.audience : 'everyone';
  const showOnWeb = input.showOnWeb !== false;
  const showInApp = input.showInApp !== false;
  if (!showOnWeb && !showInApp) throw new AnnouncementError(400, 'Show it on the site, in the app, or both.');
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) throw new AnnouncementError(400, 'Check the dates.');
  if (endsAt && endsAt <= startsAt) throw new AnnouncementError(400, 'The end has to be after the start.');
  return { title, body, linkUrl, linkLabel, tone, audience, showOnWeb, showInApp, dismissible: input.dismissible !== false, startsAt, endsAt };
}

function statusOf(row) {
  const now = Date.now();
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return 'ended';
  if (new Date(row.starts_at).getTime() > now) return 'scheduled';
  return 'live';
}

async function list({ status } = {}) {
  assertReady();
  const rows = await select(
    `SELECT a.*, u.firstname, u.lastname FROM announcements a LEFT JOIN "Users" u ON u.id = a.created_by
      ORDER BY a.created_at DESC LIMIT 200`
  );
  const items = rows.map((row) => ({
    ...shape(row),
    status: statusOf(row),
    createdAt: row.created_at,
    createdBy: [row.firstname, row.lastname].filter(Boolean).join(' ') || null,
  }));
  return { items: status ? items.filter((i) => i.status === status) : items };
}

const columns = (v) => ({
  title: v.title, body: v.body, linkUrl: v.linkUrl, linkLabel: v.linkLabel, tone: v.tone, audience: v.audience,
  showOnWeb: v.showOnWeb, showInApp: v.showInApp, dismissible: v.dismissible, startsAt: v.startsAt, endsAt: v.endsAt,
});

async function create({ input, actor }) {
  assertReady();
  const v = validate(input);
  const [row] = await select(
    `INSERT INTO announcements (title, body, link_url, link_label, tone, audience, show_on_web, show_in_app, dismissible, starts_at, ends_at, created_by)
     VALUES (:title, :body, :linkUrl, :linkLabel, :tone, :audience, :showOnWeb, :showInApp, :dismissible, :startsAt, :endsAt, :actor)
     RETURNING *`,
    { ...columns(v), actor: actor.id }
  );
  await loadLive();
  return { ...shape(row), status: statusOf(row) };
}

async function update({ id, input }) {
  assertReady();
  if (!UUID.test(String(id))) throw new AnnouncementError(404, 'Announcement not found.');
  const v = validate(input);
  const [row] = await select(
    `UPDATE announcements SET title = :title, body = :body, link_url = :linkUrl, link_label = :linkLabel, tone = :tone,
            audience = :audience, show_on_web = :showOnWeb, show_in_app = :showInApp, dismissible = :dismissible,
            starts_at = :startsAt, ends_at = :endsAt, updated_at = NOW()
      WHERE id = :id RETURNING *`,
    { ...columns(v), id }
  );
  if (!row) throw new AnnouncementError(404, 'Announcement not found.');
  await loadLive();
  return { ...shape(row), status: statusOf(row) };
}

async function endNow({ id }) {
  assertReady();
  if (!UUID.test(String(id))) throw new AnnouncementError(404, 'Announcement not found.');
  const [row] = await select(
    `UPDATE announcements SET ends_at = NOW(), updated_at = NOW() WHERE id = :id AND (ends_at IS NULL OR ends_at > NOW()) RETURNING *`,
    { id }
  );
  if (!row) throw new AnnouncementError(409, 'That announcement has already ended.');
  await loadLive();
  return { ...shape(row), status: statusOf(row) };
}

async function remove({ id }) {
  assertReady();
  if (!UUID.test(String(id))) throw new AnnouncementError(404, 'Announcement not found.');
  const rows = await select('DELETE FROM announcements WHERE id = :id RETURNING id', { id });
  if (!rows.length) throw new AnnouncementError(404, 'Announcement not found.');
  await loadLive();
  return { deleted: true };
}

module.exports = { start, activeFor, list, create, update, endNow, remove, AnnouncementError };
