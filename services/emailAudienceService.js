const sequelize = require('../config/db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$';

const MAX_PICKED_USERS = 5000;
const MAX_AUDIENCE = 20000;
const MAX_FILTER_IDS = 50;

// Lagos is UTC+1 all year, so month/day boundaries are computed on that offset.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SIGNUP_PRESETS = ['today', 'last_7_days', 'last_30_days', 'this_month', 'last_month', 'custom'];

const uniq = (list) => [...new Set(list)];

const cleanUuids = (value) =>
  uniq((Array.isArray(value) ? value : []).map(String).filter((v) => UUID_RE.test(v))).slice(0, MAX_FILTER_IDS);

const cleanUserIds = (value, max) =>
  uniq((Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)).slice(0, max);

const cleanTriState = (value) => (value === 'yes' || value === 'no' ? value : null);

/** Normalises whatever the client sent into the only shape the query builder accepts. */
const normalizeAudience = (raw = {}) => {
  const filters = raw.filters || {};
  const signup = filters.signup || {};
  const preset = SIGNUP_PRESETS.includes(signup.preset) ? signup.preset : null;

  return {
    mode: raw.mode === 'selected' ? 'selected' : 'filters',
    filters: {
      signup: {
        preset,
        from: preset === 'custom' && DATE_RE.test(signup.from || '') ? signup.from : null,
        to: preset === 'custom' && DATE_RE.test(signup.to || '') ? signup.to : null
      },
      liveClassIds: cleanUuids(filters.liveClassIds),
      liveSeriesIds: cleanUuids(filters.liveSeriesIds),
      purchased: cleanTriState(filters.purchased),
      joinedLiveClass: cleanTriState(filters.joinedLiveClass),
      includeAdmins: filters.includeAdmins === true
    },
    userIds: cleanUserIds(raw.userIds, MAX_PICKED_USERS),
    excludeUserIds: cleanUserIds(raw.excludeUserIds, MAX_PICKED_USERS)
  };
};

/** Returns [from, to) in UTC for a signup preset, or null when no date filter applies. */
const resolveSignupRange = (signup, now = new Date()) => {
  if (!signup || !signup.preset) return null;

  const lagosNow = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const year = lagosNow.getUTCFullYear();
  const month = lagosNow.getUTCMonth();
  const day = lagosNow.getUTCDate();
  const monthStart = (y, m) => new Date(Date.UTC(y, m, 1) - LAGOS_OFFSET_MS);

  switch (signup.preset) {
    case 'today':
      return [new Date(Date.UTC(year, month, day) - LAGOS_OFFSET_MS), now];
    case 'last_7_days':
      return [new Date(now.getTime() - 7 * DAY_MS), now];
    case 'last_30_days':
      return [new Date(now.getTime() - 30 * DAY_MS), now];
    case 'this_month':
      return [monthStart(year, month), now];
    case 'last_month':
      return [monthStart(year, month - 1), monthStart(year, month)];
    case 'custom': {
      if (!signup.from && !signup.to) return null;
      const from = signup.from ? new Date(`${signup.from}T00:00:00+01:00`) : new Date(0);
      const to = signup.to ? new Date(new Date(`${signup.to}T00:00:00+01:00`).getTime() + DAY_MS) : new Date(now.getTime() + DAY_MS);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
      return [from, to];
    }
    default:
      return null;
  }
};

const buildWhere = (rawAudience, now = new Date()) => {
  const audience = normalizeAudience(rawAudience);
  const { filters } = audience;
  const where = [
    'u.email IS NOT NULL',
    'u.email ~ :emailPattern',
    "u.role <> 'email_marketer'",
    'NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = lower(u.email))'
  ];
  const replacements = { emailPattern: EMAIL_PATTERN };

  if (audience.mode === 'selected') {
    if (!audience.userIds.length) {
      where.push('FALSE');
    } else {
      where.push('u.id IN (:pickedUserIds)');
      replacements.pickedUserIds = audience.userIds;
    }
  } else {
    if (!filters.includeAdmins) where.push("u.role <> 'admin'");

    const range = resolveSignupRange(filters.signup, now);
    if (range) {
      where.push('u."createdAt" >= :signupFrom AND u."createdAt" < :signupTo');
      replacements.signupFrom = range[0];
      replacements.signupTo = range[1];
    }

    if (filters.liveClassIds.length) {
      where.push('EXISTS (SELECT 1 FROM live_attendees a WHERE a.user_id = u.id AND a.live_class_id IN (:liveClassIds))');
      replacements.liveClassIds = filters.liveClassIds;
    }

    if (filters.liveSeriesIds.length) {
      where.push(`(
        EXISTS (SELECT 1 FROM purchases p WHERE p.user_id = u.id AND p.content_type = 'live_series'
                AND p.payment_status = 'completed' AND p.content_id IN (:liveSeriesIds))
        OR EXISTS (SELECT 1 FROM live_series_registrations r WHERE r.user_id = u.id AND r.series_id IN (:liveSeriesIds))
      )`);
      replacements.liveSeriesIds = filters.liveSeriesIds;
    }

    if (filters.purchased) {
      const exists = "EXISTS (SELECT 1 FROM purchases p2 WHERE p2.user_id = u.id AND p2.payment_status = 'completed')";
      where.push(filters.purchased === 'yes' ? exists : `NOT ${exists}`);
    }

    if (filters.joinedLiveClass) {
      const exists = 'EXISTS (SELECT 1 FROM live_attendees a2 WHERE a2.user_id = u.id)';
      where.push(filters.joinedLiveClass === 'yes' ? exists : `NOT ${exists}`);
    }
  }

  if (audience.excludeUserIds.length) {
    where.push('u.id NOT IN (:excludedUserIds)');
    replacements.excludedUserIds = audience.excludeUserIds;
  }

  return { where, replacements, audience };
};

const query = (sql, replacements) =>
  sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

const countAudience = async (rawAudience) => {
  const { where, replacements } = buildWhere(rawAudience);
  const [row] = await query(
    `SELECT COUNT(DISTINCT lower(u.email))::int AS total FROM "Users" u WHERE ${where.join(' AND ')}`,
    replacements
  );
  return row.total;
};

/** Paged list of matching users (one row per distinct email), newest signups first. */
const listAudience = async (rawAudience, { search = '', page = 1, limit = 25 } = {}) => {
  const { where, replacements } = buildWhere(rawAudience);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const clauses = [...where];

  const term = String(search || '').trim().slice(0, 100);
  if (term) {
    clauses.push('(u.email ILIKE :search OR u.firstname ILIKE :search OR u.lastname ILIKE :search)');
    replacements.search = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
  }

  const whereSql = clauses.join(' AND ');
  const [{ total }] = await query(
    `SELECT COUNT(DISTINCT lower(u.email))::int AS total FROM "Users" u WHERE ${whereSql}`,
    replacements
  );

  const rows = await query(
    `SELECT * FROM (
       SELECT DISTINCT ON (lower(u.email)) u.id, u.firstname AS "firstName", u.lastname AS "lastName",
              u.email, u."createdAt" AS "createdAt"
       FROM "Users" u WHERE ${whereSql}
       ORDER BY lower(u.email), u."createdAt" DESC
     ) t ORDER BY t."createdAt" DESC, t.id DESC LIMIT :limit OFFSET :offset`,
    { ...replacements, limit: safeLimit, offset: (safePage - 1) * safeLimit }
  );

  return { users: rows, total, page: safePage, limit: safeLimit, totalPages: Math.max(Math.ceil(total / safeLimit), 1) };
};

/** Full recipient snapshot used when a campaign is sent. */
const resolveAudience = async (rawAudience) => {
  const { where, replacements } = buildWhere(rawAudience);
  const rows = await query(
    `SELECT DISTINCT ON (lower(u.email)) u.id, u.firstname AS "firstName", u.lastname AS "lastName", lower(u.email) AS email
     FROM "Users" u WHERE ${where.join(' AND ')}
     ORDER BY lower(u.email), u."createdAt" DESC
     LIMIT :cap`,
    { ...replacements, cap: MAX_AUDIENCE + 1 }
  );
  if (rows.length > MAX_AUDIENCE) {
    const error = new Error(`Audience is larger than ${MAX_AUDIENCE} recipients. Narrow your filters and send in parts.`);
    error.statusCode = 400;
    throw error;
  }
  return rows;
};

/** Live classes and series to pick from in the filter UI, with how many people each would reach. */
const getAudienceOptions = async () => {
  const [liveClasses, liveSeries, [totals]] = await Promise.all([
    query(
      `SELECT c.id, c.title, c.start_time AS "startTime",
              (SELECT COUNT(DISTINCT a.user_id) FROM live_attendees a WHERE a.live_class_id = c.id)::int AS attendees
       FROM live_classes c ORDER BY c.start_time DESC NULLS LAST LIMIT 200`
    ),
    query(
      `SELECT s.id, s.title, s.start_date AS "startDate",
              (SELECT COUNT(*) FROM (
                 SELECT user_id FROM purchases WHERE content_type = 'live_series' AND content_id = s.id AND payment_status = 'completed'
                 UNION
                 SELECT user_id FROM live_series_registrations WHERE series_id = s.id
               ) enrolled)::int AS enrolled
       FROM live_series s ORDER BY s.start_date DESC NULLS LAST LIMIT 100`
    ),
    query(
      `SELECT COUNT(*)::int AS "allUsers",
              (SELECT COUNT(*) FROM email_suppressions)::int AS unsubscribed
       FROM "Users"`
    )
  ]);

  return {
    liveClasses,
    liveSeries,
    signupPresets: SIGNUP_PRESETS,
    totals
  };
};

module.exports = {
  normalizeAudience,
  resolveSignupRange,
  buildWhere,
  countAudience,
  listAudience,
  resolveAudience,
  getAudienceOptions,
  MAX_AUDIENCE
};
