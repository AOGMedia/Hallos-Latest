const { col, fn, Op } = require('sequelize');
const User = require('../models/User');
const { avatarUrlOf } = require('../utils/userAvatar');

/**
 * Admin view of live classes and live series, and the force stop.
 *
 * Models are required when called, so this file adds nothing to what
 * sequelize.sync() creates on boot. Stream keys and RTMP URLs are never sent
 * to the admin: seeing them would let someone broadcast as the creator.
 */
const models = () => {
  const { LiveClass, LiveAttendee, LiveHost } = require('../models/liveIndex');
  const { LiveSeries, LiveSession } = require('../models/liveSeriesIndex');
  return {
    LiveClass,
    LiveAttendee,
    LiveHost,
    LiveSeries,
    LiveSession,
    LiveSeriesRegistration: require('../models/LiveSeriesRegistration'),
    Purchase: require('../models/Purchase'),
    LiveGift: require('../models/LiveGift'),
    Community: require('../models/Community'),
  };
};

class AdminLiveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CLASS_FIELDS = ['id', 'userId', 'title', 'description', 'price', 'currency', 'category', 'thumbnailUrl',
  'startTime', 'endTime', 'privacy', 'status', 'streaming_provider', 'max_participants', 'communityId',
  'createdAt', 'updatedAt'];
const SERIES_FIELDS = ['id', 'userId', 'title', 'description', 'price', 'currency', 'category', 'thumbnailUrl',
  'startDate', 'endDate', 'status', 'privacy', 'maxParticipants', 'streamingProvider', 'communityId', 'createdAt'];

async function safe(label, load, fallback) {
  try {
    return await load();
  } catch (error) {
    console.warn(`[AdminLive] ${label} unavailable:`, error.message);
    return fallback;
  }
}

async function peopleById(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await User.findAll({
    where: { id: unique },
    attributes: ['id', 'firstname', 'lastname', 'email', 'socialLinks'],
  });
  return new Map(rows.map((user) => [user.id, {
    id: user.id,
    firstname: user.firstname,
    lastname: user.lastname,
    email: user.email,
    avatarUrl: avatarUrlOf(user),
  }]));
}

async function countBy(Model, key, ids, where = {}) {
  if (ids.length === 0) return new Map();
  const rows = await Model.findAll({
    where: { ...where, [key]: ids },
    attributes: [key, [fn('COUNT', col('id')), 'count']],
    group: [key],
    raw: true,
  });
  return new Map(rows.map((row) => [String(row[key]), Number(row.count)]));
}

async function revenueFor(contentType, contentId, m) {
  const rows = await m.Purchase.findAll({
    where: { contentType, contentId, paymentStatus: 'completed' },
    attributes: ['currency', [fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
    group: ['currency'],
    raw: true,
  });
  return rows.map((row) => ({ currency: row.currency, total: Number(row.total) || 0, count: Number(row.count) || 0 }));
}

const page = ({ page: p = 1, limit = 20 }) => {
  const current = Math.max(parseInt(p, 10) || 1, 1);
  const size = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return { current, size, offset: (current - 1) * size };
};
const titleSearch = (search) => (search ? { title: { [Op.iLike]: `%${String(search).slice(0, 100)}%` } } : {});

/** What's live right now, and what's coming. */
async function getOverview() {
  const m = models();
  const now = new Date();
  const dayAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const [liveClasses, liveSessions, classesToday, sessionsToday, activeSeries, classesTotal] = await Promise.all([
    m.LiveClass.findAll({ where: { status: 'live' }, attributes: CLASS_FIELDS, order: [['updatedAt', 'DESC']], raw: true }),
    m.LiveSession.findAll({
      where: { status: 'live' },
      include: [{ model: m.LiveSeries, as: 'series', attributes: SERIES_FIELDS }],
      order: [['actualStartTime', 'DESC']],
    }),
    m.LiveClass.count({ where: { status: 'scheduled', startTime: { [Op.between]: [now, dayAhead] } } }),
    m.LiveSession.count({ where: { status: 'scheduled', scheduledStartTime: { [Op.between]: [now, dayAhead] } } }),
    m.LiveSeries.count({ where: { status: 'active' } }),
    m.LiveClass.count(),
  ]);

  const sessions = liveSessions.map((row) => row.get({ plain: true }));
  const [people, attendees, registrations] = await Promise.all([
    peopleById([...liveClasses.map((c) => c.userId), ...sessions.map((s) => s.series?.userId)]),
    safe('attendees', () => countBy(m.LiveAttendee, 'liveClassId', liveClasses.map((c) => c.id)), new Map()),
    safe('registrations', () => countBy(m.LiveSeriesRegistration, 'seriesId', sessions.map((s) => s.seriesId)), new Map()),
  ]);

  return {
    liveNow: [
      ...liveClasses.map((c) => ({
        kind: 'class',
        id: c.id,
        title: c.title,
        provider: c.streaming_provider,
        startedAt: c.startTime,
        creator: people.get(c.userId) ?? null,
        audience: attendees.get(String(c.id)) ?? 0,
      })),
      ...sessions.map((s) => ({
        kind: 'session',
        id: s.id,
        seriesId: s.seriesId,
        title: `${s.series?.title ?? 'Live series'} · Session ${s.sessionNumber}`,
        provider: s.series?.streamingProvider ?? null,
        startedAt: s.actualStartTime ?? s.scheduledStartTime,
        creator: people.get(s.series?.userId) ?? null,
        audience: registrations.get(String(s.seriesId)) ?? 0,
      })),
    ],
    startingInNextDay: classesToday + sessionsToday,
    activeSeries,
    classesTotal,
  };
}

async function listClasses(query) {
  const m = models();
  const { current, size, offset } = page(query);
  const where = { ...titleSearch(query.search) };
  if (query.status) where.status = query.status;
  const { count, rows } = await m.LiveClass.findAndCountAll({
    where,
    attributes: CLASS_FIELDS,
    order: [['startTime', 'DESC']],
    limit: size,
    offset,
    raw: true,
  });
  const ids = rows.map((row) => row.id);
  const [people, attendees] = await Promise.all([
    peopleById(rows.map((row) => row.userId)),
    safe('attendees', () => countBy(m.LiveAttendee, 'liveClassId', ids), new Map()),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      creator: people.get(row.userId) ?? null,
      attendeeCount: attendees.get(String(row.id)) ?? 0,
    })),
    pagination: { total: count, page: current, limit: size, totalPages: Math.ceil(count / size) },
  };
}

async function getClass(id) {
  const m = models();
  const liveClass = await m.LiveClass.findByPk(id, { attributes: CLASS_FIELDS, raw: true });
  if (!liveClass) return null;

  const [attendees, hosts, revenue, gifts, community] = await Promise.all([
    safe('attendees', () => m.LiveAttendee.findAll({ where: { liveClassId: id }, order: [['createdAt', 'DESC']], limit: 200, raw: true }), []),
    safe('hosts', () => m.LiveHost.findAll({ where: { liveClassId: id }, raw: true }), []),
    safe('revenue', () => revenueFor('live_class', id, m), []),
    safe('gifts', async () => (await m.LiveGift.findAll({
      where: { contentType: 'live_class', contentId: id },
      attributes: ['currency', [fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
      group: ['currency'],
      raw: true,
    })).map((row) => ({ currency: row.currency, total: (Number(row.total) || 0) / 100, count: Number(row.count) || 0 })), []),
    safe('community', () => (liveClass.communityId
      ? m.Community.findByPk(liveClass.communityId, { attributes: ['id', 'name'], raw: true })
      : null), null),
  ]);
  const people = await peopleById([liveClass.userId, ...attendees.map((a) => a.userId), ...hosts.map((h) => h.userId)]);

  return {
    ...liveClass,
    creator: people.get(liveClass.userId) ?? null,
    community,
    hosts: hosts.map((host) => ({ role: host.role, person: people.get(host.userId) ?? null })),
    attendeeCount: attendees.length,
    attendees: attendees.map((row) => ({
      id: row.id,
      paid: Boolean(row.statusPaid),
      joinedAt: row.createdAt,
      person: people.get(row.userId) ?? null,
    })),
    revenue,
    gifts,
  };
}

async function listSeries(query) {
  const m = models();
  const { current, size, offset } = page(query);
  const where = { ...titleSearch(query.search) };
  if (query.status) where.status = query.status;
  const { count, rows } = await m.LiveSeries.findAndCountAll({
    where,
    attributes: SERIES_FIELDS,
    order: [['startDate', 'DESC']],
    limit: size,
    offset,
    raw: true,
  });
  const ids = rows.map((row) => row.id);
  const [people, students, sessions, live] = await Promise.all([
    peopleById(rows.map((row) => row.userId)),
    safe('students', () => countBy(m.LiveSeriesRegistration, 'seriesId', ids), new Map()),
    safe('sessions', () => countBy(m.LiveSession, 'seriesId', ids), new Map()),
    safe('live sessions', () => countBy(m.LiveSession, 'seriesId', ids, { status: 'live' }), new Map()),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      creator: people.get(row.userId) ?? null,
      studentCount: students.get(String(row.id)) ?? 0,
      sessionCount: sessions.get(String(row.id)) ?? 0,
      isLiveNow: (live.get(String(row.id)) ?? 0) > 0,
    })),
    pagination: { total: count, page: current, limit: size, totalPages: Math.ceil(count / size) },
  };
}

async function getSeries(id) {
  const m = models();
  const series = await m.LiveSeries.findByPk(id, { attributes: SERIES_FIELDS, raw: true });
  if (!series) return null;
  const [sessions, registrations, revenue, community] = await Promise.all([
    safe('sessions', () => m.LiveSession.findAll({
      where: { seriesId: id },
      attributes: ['id', 'sessionNumber', 'scheduledStartTime', 'scheduledEndTime', 'actualStartTime', 'actualEndTime', 'status', 'recordingUrl'],
      order: [['sessionNumber', 'ASC']],
      raw: true,
    }), []),
    safe('registrations', () => m.LiveSeriesRegistration.findAll({ where: { seriesId: id }, order: [['createdAt', 'DESC']], limit: 200, raw: true }), []),
    safe('revenue', () => revenueFor('live_series', id, m), []),
    safe('community', () => (series.communityId
      ? m.Community.findByPk(series.communityId, { attributes: ['id', 'name'], raw: true })
      : null), null),
  ]);
  const people = await peopleById([series.userId, ...registrations.map((r) => r.userId)]);
  return {
    ...series,
    creator: people.get(series.userId) ?? null,
    community,
    sessions,
    studentCount: registrations.length,
    students: registrations.map((row) => ({ id: row.id, joinedAt: row.createdAt, person: people.get(row.userId) ?? null })),
    revenue,
  };
}

/**
 * Ends a live class for everyone, the same way the creator's End button does
 * for its provider. If the provider call fails the class is still marked
 * ended, so it stops showing as live, and the warning is returned.
 */
async function forceEndClass(id, adminId) {
  const m = models();
  const liveClass = await m.LiveClass.findByPk(id);
  if (!liveClass) throw new AdminLiveError(404, 'Live class not found');
  if (liveClass.status !== 'live') throw new AdminLiveError(409, 'This class isn’t live right now.');

  let warning = null;
  try {
    if (liveClass.streaming_provider === 'getstream') {
      const { getStreamService } = require('./getStreamService');
      await getStreamService.endSession(liveClass);
    } else if (liveClass.streaming_provider === 'zegocloud') {
      const { zegoCloudService } = require('./zegoCloudService');
      await zegoCloudService.endLiveSession(liveClass.id, 'admin_ended');
    }
  } catch (error) {
    warning = `The streaming service didn’t confirm: ${error.message}`;
    console.error(`[AdminLive] Provider end failed for class ${id}:`, error.message);
  }
  await liveClass.reload();
  if (liveClass.status === 'live') await liveClass.update({ status: 'ended', endTime: new Date() });
  console.log(`[AdminLive] Class ${id} force-ended by admin ${adminId}${warning ? ' (with provider warning)' : ''}`);
  return { status: liveClass.status, warning };
}

/** Same as forceEndClass, for one session of a live series. */
async function forceEndSession(id, adminId) {
  const m = models();
  const session = await m.LiveSession.findByPk(id, {
    include: [{ model: m.LiveSeries, as: 'series', attributes: ['id', 'streamingProvider'] }],
  });
  if (!session) throw new AdminLiveError(404, 'Session not found');
  if (session.status !== 'live') throw new AdminLiveError(409, 'This session isn’t live right now.');

  let warning = null;
  try {
    if (session.series?.streamingProvider === 'getstream') {
      const { getStreamService } = require('./getStreamService');
      await getStreamService.endSeriesSession(session);
    } else if (session.zegoRoomId) {
      const { zegoCloudService } = require('./zegoCloudService');
      await zegoCloudService.deleteRoom(session.zegoRoomId);
    }
  } catch (error) {
    warning = `The streaming service didn’t confirm: ${error.message}`;
    console.error(`[AdminLive] Provider end failed for session ${id}:`, error.message);
  }
  await session.reload();
  if (session.status === 'live') await session.update({ status: 'ended', actualEndTime: new Date() });
  console.log(`[AdminLive] Session ${id} force-ended by admin ${adminId}${warning ? ' (with provider warning)' : ''}`);
  return { status: session.status, warning };
}

module.exports = {
  AdminLiveError,
  getOverview,
  listClasses,
  getClass,
  listSeries,
  getSeries,
  forceEndClass,
  forceEndSession,
};
