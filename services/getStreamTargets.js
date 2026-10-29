const { LiveClass, LiveHost } = require('../models/liveIndex');
const { LiveSeries, LiveSession } = require('../models/liveSeriesIndex');
const Purchase = require('../models/Purchase');
const liveSeriesService = require('./liveSeriesService');
const { seriesProviderOf } = require('../utils/liveProviders');

/**
 * Resolves what a GetStream room belongs to — a live class or a series
 * session — into the facts the in-room features (gifts, chat photos) need.
 * Access follows the same rules as joining the room.
 *
 * @typedef {object} RoomTarget
 * @property {'class'|'session'} kind
 * @property {string} id
 * @property {'live_class'|'live_session'} contentType
 * @property {string|null} callId     current GetStream call
 * @property {boolean} isLive
 * @property {number} hostUserId
 * @property {string} currency       the class/series currency
 * @property {(userId: number) => Promise<'host'|'cohost'|'attendee'|null>} roleOf
 */

class TargetError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** @returns {Promise<RoomTarget>} */
const resolveClass = async (id) => {
  const liveClass = await LiveClass.findByPk(id);
  if (!liveClass) throw new TargetError('Live class not found', 404);
  if (liveClass.streaming_provider !== 'getstream') {
    throw new TargetError('This live class is not configured for GetStream streaming', 400);
  }
  return {
    kind: 'class',
    id: liveClass.id,
    contentType: 'live_class',
    callId: liveClass.getstream_call_id || null,
    isLive: liveClass.status === 'live' && Boolean(liveClass.getstream_call_id),
    hostUserId: liveClass.userId,
    currency: liveClass.currency || 'NGN',
    roleOf: async (userId) => {
      if (liveClass.userId === userId) return 'host';
      const host = await LiveHost.findOne({ where: { liveClassId: liveClass.id, userId } });
      if (host) return 'cohost';
      if (parseFloat(liveClass.price) === 0) return 'attendee';
      const purchase = await Purchase.findOne({
        where: { userId, contentType: 'live_class', contentId: liveClass.id, paymentStatus: 'completed' }
      });
      return purchase ? 'attendee' : null;
    }
  };
};

/** @returns {Promise<RoomTarget>} */
const resolveSession = async (id) => {
  const session = await LiveSession.findByPk(id, { include: [{ model: LiveSeries, as: 'series' }] });
  if (!session) throw new TargetError('Session not found', 404);
  if (seriesProviderOf(session.series) !== 'getstream') {
    throw new TargetError('This series is not configured for GetStream streaming', 400);
  }
  return {
    kind: 'session',
    id: session.id,
    contentType: 'live_session',
    callId: String(session.id),
    isLive: session.status === 'live',
    hostUserId: session.series.userId,
    currency: session.series.currency || 'NGN',
    roleOf: async (userId) => {
      if (session.series.userId === userId) return 'host';
      return (await liveSeriesService.checkSeriesAccess(userId, session.seriesId)) ? 'attendee' : null;
    }
  };
};

/** @param {'class'|'session'} kind */
const resolveTarget = (kind, id) => (kind === 'session' ? resolveSession(id) : resolveClass(id));

module.exports = { resolveTarget, TargetError };
