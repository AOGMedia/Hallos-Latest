const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Takedowns and user reports.
 *
 * Videos are taken down by making them private, which the feed and video page
 * already respect (creators can't change it back; there's no route for that).
 * The previous setting is stored so restoring puts it back exactly.
 * Freebies have no visibility setting, so the freebie endpoints ask
 * isFreebieHidden(), an in-memory lookup kept fresh the same way as
 * suspensions: no timers, reloaded by traffic at most every 30 seconds.
 */
const MAX_AGE_MS = 30 * 1000;
const TAKEDOWN_TYPES = ['video', 'freebie'];
const REPORT_TYPES = ['video', 'freebie', 'live_class', 'live_series', 'community', 'user'];
const REPORT_REASONS = ['spam', 'scam', 'harassment', 'hate', 'sexual', 'violence', 'copyright', 'misleading', 'other'];

class ModerationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const isReady = () => require('../utils/ensureAdminFoundations').isAdminFoundationsReady();
const assertReady = () => {
  if (!isReady()) throw new ModerationError(503, 'Moderation is unavailable right now. Check the server logs.');
};

// --- Hidden freebies (in memory) ---------------------------------------------

let hiddenFreebies = new Set();
let loadedAt = 0;
let loading = null;

async function reloadHidden() {
  if (!isReady()) return;
  loadedAt = Date.now();
  try {
    const rows = await select(
      "SELECT content_id FROM content_takedowns WHERE content_type = 'freebie' AND restored_at IS NULL"
    );
    hiddenFreebies = new Set(rows.map((row) => String(row.content_id)));
  } catch (error) {
    console.warn('[Moderation] Could not load takedowns:', error.message);
  }
}

function loadHidden(force = true) {
  if (loading || (!force && Date.now() - loadedAt < MAX_AGE_MS)) return;
  loading = reloadHidden().finally(() => {
    loading = null;
  });
}

/** Fast, synchronous: safe on every freebie request. Fails open. */
function isFreebieHidden(id) {
  loadHidden(false);
  return hiddenFreebies.has(String(id));
}

/** For list queries: the ids to leave out, or an empty array. */
function hiddenFreebieIds() {
  loadHidden(false);
  return [...hiddenFreebies];
}

// --- Takedowns ---------------------------------------------------------------

async function openTakedown(type, id) {
  const [row] = await select(
    `SELECT t.id, t.reason, t.created_at AS "createdAt", t.previous_state AS "previousState",
            NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), '') AS "createdByName"
       FROM content_takedowns t LEFT JOIN "Users" u ON u.id = t.created_by
      WHERE t.content_type = :type AND t.content_id = :id AND t.restored_at IS NULL`,
    { type, id: String(id) }
  );
  return row || null;
}

async function takeDown({ type, id, reason, actor }) {
  assertReady();
  if (!TAKEDOWN_TYPES.includes(type)) throw new ModerationError(400, 'This kind of content can’t be taken down here.');
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) throw new ModerationError(400, 'Give a reason so this can be understood later.');
  if (await openTakedown(type, id)) throw new ModerationError(409, 'This is already taken down.');

  await sequelize.transaction(async (transaction) => {
    let previous = null;
    if (type === 'video') {
      const [video] = await sequelize.query('SELECT id, privacy FROM videos WHERE id::text = :id FOR UPDATE', {
        replacements: { id: String(id) }, type: QueryTypes.SELECT, transaction,
      });
      if (!video) throw new ModerationError(404, 'Video not found');
      previous = { privacy: video.privacy };
      await sequelize.query("UPDATE videos SET privacy = 'private', updated_at = NOW() WHERE id = :id", {
        replacements: { id: video.id }, transaction,
      });
    } else {
      const [freebie] = await sequelize.query('SELECT id FROM freebies WHERE id::text = :id', {
        replacements: { id: String(id) }, type: QueryTypes.SELECT, transaction,
      });
      if (!freebie) throw new ModerationError(404, 'Freebie not found');
    }
    await sequelize.query(
      `INSERT INTO content_takedowns (content_type, content_id, reason, previous_state, created_by)
       VALUES (:type, :id, :reason, CAST(:previous AS JSONB), :actorId)`,
      { replacements: { type, id: String(id), reason: cleanReason.slice(0, 1000), previous: JSON.stringify(previous), actorId: actor.id }, transaction }
    );
  });
  if (type === 'freebie') hiddenFreebies.add(String(id));
  console.log(`[Moderation] ${type} ${id} taken down by ${actor.id}`);
  return openTakedown(type, id);
}

async function restore({ type, id, actor }) {
  assertReady();
  const open = await openTakedown(type, id);
  if (!open) throw new ModerationError(409, 'This isn’t taken down.');
  await sequelize.transaction(async (transaction) => {
    if (type === 'video') {
      const privacy = ['public', 'unlisted', 'private'].includes(open.previousState?.privacy) ? open.previousState.privacy : 'public';
      await sequelize.query('UPDATE videos SET privacy = :privacy, updated_at = NOW() WHERE id::text = :id', {
        replacements: { privacy, id: String(id) }, transaction,
      });
    }
    await sequelize.query(
      'UPDATE content_takedowns SET restored_at = NOW(), restored_by = :actorId WHERE id = :takedownId',
      { replacements: { actorId: actor.id, takedownId: open.id }, transaction }
    );
  });
  if (type === 'freebie') hiddenFreebies.delete(String(id));
  console.log(`[Moderation] ${type} ${id} restored by ${actor.id}`);
  return { restored: true };
}

// --- Content lists for the admin ---------------------------------------------

const paging = ({ page = 1, limit = 20 }) => {
  const size = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const current = Math.max(parseInt(page, 10) || 1, 1);
  return { size, current, offset: (current - 1) * size };
};
const like = (term) => `%${String(term).trim().slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`;
const pageOf = (items, total, size, current) => ({
  items,
  pagination: { total, page: current, limit: size, totalPages: Math.ceil(total / size) },
});

const TAKEDOWN_JOIN = (type, idColumn) => `
  LEFT JOIN content_takedowns td
    ON td.content_type = '${type}' AND td.content_id = ${idColumn}::text AND td.restored_at IS NULL
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS open_reports FROM content_reports cr
     WHERE cr.target_type = '${type}' AND cr.target_id = ${idColumn}::text AND cr.status = 'open'
  ) rep ON TRUE`;

async function listVideos({ search, state, ...query }) {
  const { size, current, offset } = paging(query);
  const clauses = ['TRUE'];
  const replacements = { limit: size, offset };
  if (search) { clauses.push("(v.title ILIKE :search OR CONCAT(u.firstname, ' ', u.lastname) ILIKE :search)"); replacements.search = like(search); }
  if (state === 'removed') clauses.push('td.id IS NOT NULL');
  if (state === 'reported') clauses.push('rep.open_reports > 0');
  const from = `FROM videos v LEFT JOIN "Users" u ON u.id = v.user_id ${TAKEDOWN_JOIN('video', 'v.id')} WHERE ${clauses.join(' AND ')}`;
  const [{ total }] = await select(`SELECT COUNT(*)::int AS total ${from}`, replacements);
  const items = await select(
    `SELECT v.id, v.title, v.thumbnail_url AS "thumbnailUrl", v.privacy, v.status, v.price, v.currency,
            v.views_count AS "views", v.duration_seconds AS "durationSeconds", v.created_at AS "createdAt",
            v.user_id AS "creatorId", NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), '') AS "creatorName",
            td.id IS NOT NULL AS "isRemoved", td.reason AS "removalReason", rep.open_reports AS "openReports"
       ${from} ORDER BY v.created_at DESC LIMIT :limit OFFSET :offset`,
    replacements
  );
  return pageOf(items, total, size, current);
}

async function listFreebies({ search, state, ...query }) {
  const { size, current, offset } = paging(query);
  const clauses = ['TRUE'];
  const replacements = { limit: size, offset };
  if (search) { clauses.push("(f.title ILIKE :search OR CONCAT(u.firstname, ' ', u.lastname) ILIKE :search)"); replacements.search = like(search); }
  if (state === 'removed') clauses.push('td.id IS NOT NULL');
  if (state === 'reported') clauses.push('rep.open_reports > 0');
  const from = `FROM freebies f LEFT JOIN "Users" u ON u.id = f.user_id ${TAKEDOWN_JOIN('freebie', 'f.id')} WHERE ${clauses.join(' AND ')}`;
  const [{ total }] = await select(`SELECT COUNT(*)::int AS total ${from}`, replacements);
  const items = await select(
    `SELECT f.id, f.title, f.thumbnail_url AS "thumbnailUrl", f.price, f.currency, f.download_count AS "downloads",
            f.created_at AS "createdAt", f.user_id AS "creatorId",
            NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), '') AS "creatorName",
            td.id IS NOT NULL AS "isRemoved", td.reason AS "removalReason", rep.open_reports AS "openReports"
       ${from} ORDER BY f.created_at DESC LIMIT :limit OFFSET :offset`,
    replacements
  );
  return pageOf(items, total, size, current);
}

async function listCourses({ search, state, ...query }) {
  const { size, current, offset } = paging(query);
  const clauses = ['TRUE'];
  const replacements = { limit: size, offset };
  if (search) { clauses.push('c.name ILIKE :search'); replacements.search = like(search); }
  if (state === 'active') clauses.push('c.is_active = TRUE');
  if (state === 'inactive') clauses.push('c.is_active = FALSE');
  const from = `FROM courses c LEFT JOIN departments d ON d.id = c.department_id WHERE ${clauses.join(' AND ')}`;
  const [{ total }] = await select(`SELECT COUNT(*)::int AS total ${from}`, replacements);
  const items = await select(
    `SELECT c.id, c.name, c.link, c.duration, c.image_url AS "imageUrl", c.is_active AS "isActive",
            d.name AS "department",
            (SELECT COUNT(*)::int FROM course_enrollments e WHERE e.course_id = c.id) AS enrollments
       ${from} ORDER BY d.name NULLS LAST, c.name LIMIT :limit OFFSET :offset`,
    replacements
  );
  return pageOf(items, total, size, current);
}

/** Only switching a course on or off; the catalogue itself is imported. */
async function setCourseActive(id, isActive) {
  const Course = require('../models/Course');
  const course = await Course.unscoped().findByPk(id);
  if (!course) throw new ModerationError(404, 'Course not found');
  await course.update({ isActive: Boolean(isActive) });
  return { id: course.id, isActive: course.isActive };
}

// --- Reports -----------------------------------------------------------------

async function createReport({ reporterId, targetType, targetId, reason, details }) {
  assertReady();
  if (!REPORT_TYPES.includes(targetType)) throw new ModerationError(400, 'You can’t report that.');
  if (!REPORT_REASONS.includes(reason)) throw new ModerationError(400, 'Choose a reason.');
  const id = String(targetId || '').trim().slice(0, 64);
  if (!id) throw new ModerationError(400, 'Missing what you’re reporting.');
  if (targetType === 'user' && Number(id) === Number(reporterId)) throw new ModerationError(400, 'You can’t report yourself.');
  try {
    await sequelize.query(
      `INSERT INTO content_reports (reporter_id, target_type, target_id, reason, details)
       VALUES (:reporterId, :targetType, :id, :reason, :details)`,
      { replacements: { reporterId, targetType, id, reason, details: String(details || '').trim().slice(0, 2000) || null } }
    );
  } catch (error) {
    // Already reported and still open: treat as success so a repeat tap is harmless.
    if (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505') return { received: true, duplicate: true };
    throw error;
  }
  return { received: true, duplicate: false };
}

const TITLE_SQL = {
  video: "SELECT id::text AS id, title FROM videos WHERE id::text IN (:ids)",
  freebie: "SELECT id::text AS id, title FROM freebies WHERE id::text IN (:ids)",
  live_class: "SELECT id::text AS id, title FROM live_classes WHERE id::text IN (:ids)",
  live_series: "SELECT id::text AS id, title FROM live_series WHERE id::text IN (:ids)",
  community: "SELECT id::text AS id, name AS title FROM communities WHERE id::text IN (:ids)",
  user: `SELECT id::text AS id, NULLIF(TRIM(CONCAT(firstname, ' ', lastname)), '') AS title FROM "Users" WHERE id::text IN (:ids)`,
};

/** Reports grouped by the thing reported, most reported first. */
async function listReports({ status = 'open', type, ...query }) {
  if (!isReady()) return pageOf([], 0, 20, 1);
  const { size, current, offset } = paging(query);
  const clauses = ['TRUE'];
  const replacements = { limit: size, offset };
  if (['open', 'resolved', 'dismissed'].includes(status)) { clauses.push('r.status = :status'); replacements.status = status; }
  if (REPORT_TYPES.includes(type)) { clauses.push('r.target_type = :type'); replacements.type = type; }
  const where = clauses.join(' AND ');
  const [{ total }] = await select(
    `SELECT COUNT(*)::int AS total FROM (SELECT 1 FROM content_reports r WHERE ${where} GROUP BY r.target_type, r.target_id) g`,
    replacements
  );
  const groups = await select(
    `SELECT r.target_type AS "targetType", r.target_id AS "targetId",
            COUNT(*)::int AS reports, COUNT(DISTINCT r.reporter_id)::int AS reporters,
            MIN(r.created_at) AS "firstReportedAt", MAX(r.created_at) AS "lastReportedAt",
            ARRAY_AGG(DISTINCT r.reason) AS reasons,
            (ARRAY_AGG(r.details ORDER BY r.created_at DESC) FILTER (WHERE r.details IS NOT NULL))[1:3] AS notes,
            MAX(r.resolution) AS resolution
       FROM content_reports r WHERE ${where}
      GROUP BY r.target_type, r.target_id
      ORDER BY COUNT(*) DESC, MAX(r.created_at) DESC
      LIMIT :limit OFFSET :offset`,
    replacements
  );

  const titles = new Map();
  for (const [kind, sql] of Object.entries(TITLE_SQL)) {
    const ids = groups.filter((g) => g.targetType === kind).map((g) => g.targetId);
    if (!ids.length) continue;
    const rows = await select(sql, { ids }).catch(() => []);
    rows.forEach((row) => titles.set(`${kind}:${row.id}`, row.title));
  }
  const takedowns = await select(
    "SELECT content_type, content_id FROM content_takedowns WHERE restored_at IS NULL"
  ).catch(() => []);
  const removed = new Set(takedowns.map((row) => `${row.content_type}:${row.content_id}`));

  return pageOf(
    groups.map((group) => ({
      ...group,
      title: titles.get(`${group.targetType}:${group.targetId}`) ?? null,
      exists: titles.has(`${group.targetType}:${group.targetId}`),
      isRemoved: removed.has(`${group.targetType}:${group.targetId}`),
    })),
    total, size, current
  );
}

/** Closes every open report about one item at once. */
async function resolveReports({ targetType, targetId, outcome, note, actor }) {
  assertReady();
  if (!['resolved', 'dismissed'].includes(outcome)) throw new ModerationError(400, 'Choose resolved or dismissed.');
  const [, meta] = await sequelize.query(
    `UPDATE content_reports SET status = :outcome, resolution = :note, reviewed_by = :actorId, reviewed_at = NOW()
      WHERE target_type = :targetType AND target_id = :targetId AND status = 'open'`,
    { replacements: { outcome, note: String(note || '').trim().slice(0, 1000) || null, actorId: actor.id, targetType, targetId: String(targetId) } }
  );
  return { closed: meta?.rowCount || 0 };
}

async function openReportCount() {
  if (!isReady()) return 0;
  const [row] = await select("SELECT COUNT(DISTINCT (target_type, target_id))::int AS count FROM content_reports WHERE status = 'open'").catch(() => [{ count: 0 }]);
  return row.count;
}

module.exports = {
  ModerationError,
  REPORT_TYPES,
  REPORT_REASONS,
  loadHidden,
  isFreebieHidden,
  hiddenFreebieIds,
  openTakedown,
  takeDown,
  restore,
  listVideos,
  listFreebies,
  listCourses,
  setCourseActive,
  createReport,
  listReports,
  resolveReports,
  openReportCount,
};
