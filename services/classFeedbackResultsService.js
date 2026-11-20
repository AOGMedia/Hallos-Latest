const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const { isClassFeedbackReady } = require('../utils/ensureClassFeedback');
const { ANSWER_SCHEMA } = require('./classFeedbackService');

/**
 * Reading class feedback back: the admin (everything, including who sent
 * anonymous answers) and the class's creator (their participants' answers,
 * with anonymous ones nameless, and never the hosts' own notes to Hallos).
 *
 * Summaries are built from the same answer schema the form validates against,
 * so a new question shows up here without extra work.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['class', 'session'];
const PERIODS = [7, 30, 90, 365];
const select = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined ? null : Number(v));

// ── Summaries ───────────────────────────────────────────────────────────────

function ratingStats(values) {
  const ratings = values.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratings.forEach((n) => {
    distribution[n] += 1;
  });
  return {
    type: 'rating',
    answered: ratings.length,
    average: ratings.length ? round2(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
    distribution,
  };
}

/**
 * Totals per role: overall rating, every question's answers, comments.
 * rows: [{ role, overall, answers, comment | hasComment, anonymous }]
 */
function summarize(rows) {
  const out = {};
  for (const role of ['participant', 'host']) {
    const mine = rows.filter((r) => r.role === role);
    const answers = {};
    for (const [key, rule] of Object.entries(ANSWER_SCHEMA[role])) {
      const given = mine.map((r) => (r.answers || {})[key]).filter((v) => v !== undefined && v !== null);
      if (rule.type === 'rating') {
        answers[key] = ratingStats(given);
      } else if (rule.type === 'one') {
        answers[key] = {
          type: 'one',
          answered: given.length,
          counts: Object.fromEntries(rule.values.map((v) => [v, given.filter((g) => g === v).length])),
        };
      } else {
        const lists = given.filter(Array.isArray);
        answers[key] = {
          type: 'many',
          answered: lists.length,
          counts: Object.fromEntries(rule.values.map((v) => [v, lists.filter((l) => l.includes(v)).length])),
        };
      }
    }
    out[role] = {
      responses: mine.length,
      overall: ratingStats(mine.map((r) => r.overall)),
      comments: mine.filter((r) => r.hasComment ?? Boolean(r.comment && String(r.comment).trim())).length,
      anonymous: mine.filter((r) => r.anonymous).length,
      answers,
    };
  }
  return out;
}

// ── People ──────────────────────────────────────────────────────────────────

async function peopleById(ids) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(Number(id))).map(Number))];
  if (!unique.length) return new Map();
  const User = require('../models/User');
  const { avatarUrlOf } = require('../utils/userAvatar');
  const users = await User.findAll({
    where: { id: unique },
    attributes: ['id', 'firstname', 'lastname', 'email', 'socialLinks'],
  });
  return new Map(
    users.map((u) => [
      Number(u.id),
      { id: u.id, firstname: u.firstname, lastname: u.lastname, email: u.email, avatarUrl: avatarUrlOf(u) },
    ])
  );
}

/** What a creator may see about a participant: never the email, nothing at all if anonymous. */
const publicPerson = (person) =>
  person ? { firstname: person.firstname, lastname: person.lastname, avatarUrl: person.avatarUrl } : null;

// ── Classes and sessions with feedback ─────────────────────────────────────

/**
 * Every class/session that someone joined or reviewed, with its numbers.
 * Built once here so the list, the overview and the creator view agree.
 */
const TARGETS_SQL = `
  WITH att AS (
    SELECT target_kind AS kind, target_id AS id,
           COUNT(*) FILTER (WHERE role = 'participant')::int AS joined,
           COUNT(*) FILTER (WHERE role = 'host')::int AS hosts_joined,
           MAX(last_joined_at) AS last_join
      FROM live_room_attendance GROUP BY 1, 2
  ), fb AS (
    SELECT target_kind AS kind, target_id AS id,
           COUNT(*) FILTER (WHERE role = 'participant')::int AS responses,
           COUNT(*) FILTER (WHERE role = 'host')::int AS host_responses,
           AVG(overall) FILTER (WHERE role = 'participant') AS avg_overall,
           AVG(CASE WHEN role = 'participant' AND jsonb_typeof(answers->'host') = 'number'
                    THEN (answers->>'host')::numeric END) AS avg_host,
           AVG(overall) FILTER (WHERE role = 'host') AS host_overall,
           COUNT(*) FILTER (WHERE COALESCE(comment, '') <> '')::int AS comments,
           MAX(updated_at) AS last_response
      FROM class_feedback GROUP BY 1, 2
  ), t AS (
    SELECT COALESCE(att.kind, fb.kind) AS kind, COALESCE(att.id, fb.id) AS id,
           COALESCE(att.joined, 0) AS joined, COALESCE(att.hosts_joined, 0) AS hosts_joined, att.last_join,
           COALESCE(fb.responses, 0) AS responses, COALESCE(fb.host_responses, 0) AS host_responses,
           fb.avg_overall, fb.avg_host, fb.host_overall, COALESCE(fb.comments, 0) AS comments, fb.last_response
      FROM att FULL OUTER JOIN fb ON fb.kind = att.kind AND fb.id = att.id
  ), info AS (
    SELECT t.*, c.title, NULL::uuid AS series_id, NULL::int AS session_number, c.user_id AS host_id,
           c.streaming_provider::text AS provider, c.status::text AS status,
           c.start_time AS started_at, c.end_time AS ended_at
      FROM t JOIN live_classes c ON t.kind = 'class' AND c.id = t.id
    UNION ALL
    SELECT t.*, se.title, se.id, s.session_number, se.user_id,
           se.streaming_provider::text, s.status::text,
           COALESCE(s.actual_start_time, s.scheduled_start_time), s.actual_end_time
      FROM t JOIN live_sessions s ON t.kind = 'session' AND s.id = t.id
             JOIN live_series se ON se.id = s.series_id
  )
  SELECT info.*, d.sent_count, d.claimed_at, d.send_after,
         COALESCE(info.ended_at, info.last_response, info.last_join, info.started_at) AS happened_at,
         COUNT(*) OVER () AS total_count
    FROM info
    LEFT JOIN "Users" u ON u.id = info.host_id
    LEFT JOIN class_feedback_dispatch d ON d.target_kind = info.kind AND d.target_id = info.id`;

const SORTS = {
  recent: 'happened_at DESC NULLS LAST',
  lowest: 'avg_overall ASC NULLS LAST, responses DESC',
  highest: 'avg_overall DESC NULLS LAST, responses DESC',
  responses: 'responses DESC, happened_at DESC NULLS LAST',
};

const page = ({ page: p = 1, limit = 20 }) => {
  const current = Math.max(parseInt(p, 10) || 1, 1);
  const size = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return { current, size, offset: (current - 1) * size };
};

/** WHERE clause and values from list filters (all optional). Only fixed SQL; values are bound. */
function targetFilters({ search, kind, provider, rating, days, hostId, minResponses, endedOnly } = {}) {
  const where = [];
  const values = {};
  if (search && String(search).trim()) {
    where.push(`(info.title ILIKE :search OR CONCAT_WS(' ', u.firstname, u.lastname) ILIKE :search)`);
    values.search = `%${String(search).trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  if (KINDS.includes(kind)) {
    where.push('info.kind = :kind');
    values.kind = kind;
  }
  if (['getstream', 'zegocloud', 'mux'].includes(provider)) {
    where.push('info.provider = :provider');
    values.provider = provider;
  }
  if (rating === 'low') where.push('info.avg_overall < 3');
  if (rating === 'mixed') where.push('info.avg_overall >= 3 AND info.avg_overall < 4');
  if (rating === 'high') where.push('info.avg_overall >= 4');
  if (rating === 'none') where.push('info.responses = 0');
  const period = Number(days);
  if (PERIODS.includes(period)) {
    where.push(`COALESCE(info.ended_at, info.last_response, info.last_join, info.started_at) >= NOW() - (:days || ' days')::interval`);
    values.days = period;
  }
  if (hostId !== undefined) {
    // A creator's own classes only; an unusable id matches nothing (never everything).
    if (Number.isInteger(Number(hostId))) {
      where.push('info.host_id = :hostId');
      values.hostId = Number(hostId);
    } else {
      where.push('FALSE');
    }
  }
  if (endedOnly) where.push(`info.status IN ('ended', 'recorded')`);
  if (Number(minResponses) > 0) {
    where.push('info.responses >= :minResponses');
    values.minResponses = Number(minResponses);
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', values };
}

const sessionLabelOf = (n) => (n ? `Session ${n}` : null);

function emailsOf(row) {
  if (row.claimed_at) return { status: 'sent', sentCount: num(row.sent_count) ?? 0, sentAt: row.claimed_at };
  if (row.send_after) return { status: 'scheduled', sentCount: 0, scheduledFor: row.send_after };
  return { status: 'none', sentCount: 0 };
}

const rateOf = (responded, joined) => (joined > 0 ? round2(Math.min(responded / joined, 1)) : null);

async function listTargets(query = {}, options = {}) {
  if (!isClassFeedbackReady()) return { items: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } };
  const { current, size, offset } = page(query);
  // Only the filters people can pick; fixed limits (host, minimum answers) come from the caller.
  const { search, kind, provider, rating, days } = query;
  const filters = targetFilters({ search, kind, provider, rating, days, ...options });
  const order = SORTS[query.sort] || SORTS.recent;
  const rows = await select(`SELECT * FROM (${TARGETS_SQL}${filters.sql}) listed ORDER BY ${order} LIMIT :limit OFFSET :offset`, {
    ...filters.values,
    limit: size,
    offset,
  });
  const people = await peopleById(rows.map((r) => r.host_id));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      title: r.title,
      sessionLabel: sessionLabelOf(r.session_number),
      seriesId: r.series_id,
      provider: r.provider,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      host: people.get(Number(r.host_id)) ?? null,
      joined: num(r.joined),
      responses: num(r.responses),
      responseRate: rateOf(num(r.responses), num(r.joined)),
      averageOverall: r.avg_overall === null ? null : round2(Number(r.avg_overall)),
      averageHost: r.avg_host === null ? null : round2(Number(r.avg_host)),
      hostOverall: r.host_overall === null ? null : round2(Number(r.host_overall)),
      comments: num(r.comments),
      emails: emailsOf(r),
    })),
    pagination: { total, page: current, limit: size, totalPages: Math.ceil(total / size) },
  };
}

// ── One class or session ───────────────────────────────────────────────────

async function targetInfo(kind, id) {
  const sql =
    kind === 'class'
      ? `SELECT c.id, c.title, NULL AS "seriesId", NULL AS "sessionNumber", c.user_id AS "hostId",
                c.streaming_provider::text AS provider, c.status::text AS status, c.privacy::text AS privacy,
                c.start_time AS "startedAt", c.end_time AS "endedAt"
           FROM live_classes c WHERE c.id = :id`
      : `SELECT s.id, se.title, se.id AS "seriesId", s.session_number AS "sessionNumber", se.user_id AS "hostId",
                se.streaming_provider::text AS provider, s.status::text AS status, se.privacy::text AS privacy,
                COALESCE(s.actual_start_time, s.scheduled_start_time) AS "startedAt", s.actual_end_time AS "endedAt"
           FROM live_sessions s JOIN live_series se ON se.id = s.series_id WHERE s.id = :id`;
  const [row] = await select(sql, { id });
  return row || null;
}

const loadResponses = (kind, id) =>
  select(
    `SELECT id, user_id AS "userId", role, overall, answers, comment, anonymous,
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM class_feedback WHERE target_kind = :kind AND target_id = :id ORDER BY updated_at DESC`,
    { kind, id }
  );

const loadAttendance = (kind, id) =>
  select(
    `SELECT user_id AS "userId", role, first_joined_at AS "joinedAt", last_joined_at AS "lastJoinedAt"
       FROM live_room_attendance WHERE target_kind = :kind AND target_id = :id ORDER BY first_joined_at`,
    { kind, id }
  );

const validTarget = (kind, id) => KINDS.includes(kind) && UUID.test(String(id));

/** Admin: everything about one class or session's feedback, names included. */
async function adminTarget(kind, id) {
  if (!validTarget(kind, id) || !isClassFeedbackReady()) return null;
  const info = await targetInfo(kind, id);
  if (!info) return null;

  const [responses, attendance, [dispatch]] = await Promise.all([
    loadResponses(kind, id),
    loadAttendance(kind, id),
    select(
      `SELECT sent_count, claimed_at, send_after FROM class_feedback_dispatch WHERE target_kind = :kind AND target_id = :id`,
      { kind, id }
    ),
  ]);
  const people = await peopleById([info.hostId, ...responses.map((r) => r.userId), ...attendance.map((a) => a.userId)]);
  const joinedAt = new Map(attendance.map((a) => [Number(a.userId), a.joinedAt]));
  const answered = new Set(responses.map((r) => Number(r.userId)));
  const joinedParticipants = attendance.filter((a) => a.role === 'participant').length;
  const respondedParticipants = responses.filter((r) => r.role === 'participant').length;

  return {
    kind,
    id: info.id,
    title: info.title,
    sessionLabel: sessionLabelOf(info.sessionNumber),
    seriesId: info.seriesId,
    provider: info.provider,
    status: info.status,
    privacy: info.privacy,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    host: people.get(Number(info.hostId)) ?? null,
    joined: { participants: joinedParticipants, hosts: attendance.length - joinedParticipants },
    responded: { participants: respondedParticipants, hosts: responses.length - respondedParticipants },
    responseRate: rateOf(respondedParticipants, joinedParticipants),
    emails: emailsOf(dispatch || {}),
    summary: summarize(responses),
    responses: responses.map((r) => ({
      id: r.id,
      role: r.role,
      person: people.get(Number(r.userId)) ?? null,
      anonymous: r.anonymous,
      overall: r.overall,
      answers: r.answers || {},
      comment: r.comment || '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      joinedAt: joinedAt.get(Number(r.userId)) ?? null,
    })),
    // Joined but haven't answered (yet).
    waiting: attendance
      .filter((a) => !answered.has(Number(a.userId)))
      .map((a) => ({ role: a.role, person: people.get(Number(a.userId)) ?? null, joinedAt: a.joinedAt })),
  };
}

// ── Admin overview ─────────────────────────────────────────────────────────

const MAX_SUMMARY_ROWS = 20000;

/** The big picture over a period: ratings, response rate, trend, what people ask for. */
async function adminOverview({ days } = {}) {
  const period = PERIODS.includes(Number(days)) ? Number(days) : 30;
  const empty = {
    days: period,
    responses: 0,
    classes: 0,
    responseRate: null,
    summary: summarize([]),
    trend: [],
    latestComments: [],
    needsAttention: [],
  };
  if (!isClassFeedbackReady()) return empty;
  const since = { days: period };
  const unit = period <= 31 ? 'day' : 'week';

  const [rows, [rate], trend, comments, needsAttention] = await Promise.all([
    select(
      `SELECT target_kind AS kind, target_id AS "targetId", role, overall, answers, anonymous,
              (COALESCE(comment, '') <> '') AS "hasComment"
         FROM class_feedback WHERE created_at >= NOW() - (:days || ' days')::interval
        ORDER BY created_at DESC LIMIT ${MAX_SUMMARY_ROWS}`,
      since
    ),
    select(
      `SELECT COUNT(*)::int AS joined, COUNT(f.user_id)::int AS responded
         FROM live_room_attendance a
         LEFT JOIN class_feedback f
           ON f.target_kind = a.target_kind AND f.target_id = a.target_id AND f.user_id = a.user_id
        WHERE a.role = 'participant' AND a.first_joined_at >= NOW() - (:days || ' days')::interval`,
      since
    ),
    select(
      `SELECT date_trunc(:unit, created_at) AS bucket,
              COUNT(*) FILTER (WHERE role = 'participant')::int AS responses,
              AVG(overall) FILTER (WHERE role = 'participant') AS average
         FROM class_feedback WHERE created_at >= NOW() - (:days || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      { ...since, unit }
    ),
    select(
      `SELECT f.id, f.target_kind AS kind, f.target_id AS "targetId", f.user_id AS "userId", f.role,
              f.overall, f.comment, f.anonymous, f.updated_at AS "updatedAt",
              COALESCE(c.title, se.title) AS title, s.session_number AS "sessionNumber"
         FROM class_feedback f
         LEFT JOIN live_classes c ON f.target_kind = 'class' AND c.id = f.target_id
         LEFT JOIN live_sessions s ON f.target_kind = 'session' AND s.id = f.target_id
         LEFT JOIN live_series se ON se.id = s.series_id
        WHERE COALESCE(f.comment, '') <> '' AND f.created_at >= NOW() - (:days || ' days')::interval
        ORDER BY f.updated_at DESC LIMIT 12`,
      since
    ),
    listTargets({ sort: 'lowest', limit: 5 }, { days: period, minResponses: 3, rating: 'low' }),
  ]);
  const people = await peopleById(comments.map((c) => c.userId));

  return {
    days: period,
    unit,
    responses: rows.length,
    classes: new Set(rows.map((r) => `${r.kind}:${r.targetId}`)).size,
    responseRate: rate ? rateOf(rate.responded, rate.joined) : null,
    joined: rate ? rate.joined : 0,
    summary: summarize(rows),
    trend: trend.map((t) => ({
      date: t.bucket,
      responses: t.responses,
      average: t.average === null ? null : round2(Number(t.average)),
    })),
    latestComments: comments.map((c) => ({
      id: c.id,
      kind: c.kind,
      targetId: c.targetId,
      title: c.title,
      sessionLabel: sessionLabelOf(c.sessionNumber),
      role: c.role,
      overall: c.overall,
      comment: c.comment,
      anonymous: c.anonymous,
      person: people.get(Number(c.userId)) ?? null,
      updatedAt: c.updatedAt,
    })),
    needsAttention: needsAttention.items,
  };
}

// ── Creator ────────────────────────────────────────────────────────────────

class ResultsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** The creator's own classes/sessions with feedback (participants' answers only). */
async function creatorTargets(userId, query = {}) {
  // Feedback only exists once a class has ended, so only those are listed.
  const list = await listTargets(query, { hostId: userId, endedOnly: true });
  return {
    items: list.items.map(({ host: _host, emails: _emails, hostOverall: _hostOverall, ...item }) => item),
    pagination: list.pagination,
  };
}

/**
 * One of the creator's classes/sessions: what their participants said.
 * Anonymous answers have no name; hosts' and co-hosts' notes (meant for
 * Hallos) are left out entirely; nobody's email is included.
 */
async function creatorTarget(userId, kind, id) {
  const notFound = new ResultsError('We couldn’t find feedback for this class.', 404);
  if (!validTarget(kind, id) || !isClassFeedbackReady()) throw notFound;
  const info = await targetInfo(kind, id);
  if (!info || Number(info.hostId) !== Number(userId)) throw notFound;

  const [all, attendance] = await Promise.all([loadResponses(kind, id), loadAttendance(kind, id)]);
  const responses = all.filter((r) => r.role === 'participant');
  const named = responses.filter((r) => !r.anonymous).map((r) => r.userId);
  const people = await peopleById(named);
  const joined = attendance.filter((a) => a.role === 'participant').length;

  return {
    kind,
    id: info.id,
    title: info.title,
    sessionLabel: sessionLabelOf(info.sessionNumber),
    seriesId: info.seriesId,
    status: info.status,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    joined,
    responses: responses.length,
    responseRate: rateOf(responses.length, joined),
    summary: summarize(responses).participant,
    feedback: responses.map((r) => ({
      id: r.id,
      anonymous: r.anonymous,
      person: r.anonymous ? null : publicPerson(people.get(Number(r.userId))),
      overall: r.overall,
      answers: r.answers || {},
      comment: r.comment || '',
      updatedAt: r.updatedAt,
    })),
  };
}

module.exports = {
  ResultsError,
  summarize,
  targetFilters,
  listTargets,
  adminTarget,
  adminOverview,
  creatorTargets,
  creatorTarget,
};
