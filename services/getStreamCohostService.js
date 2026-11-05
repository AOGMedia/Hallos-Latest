/**
 * The creator makes someone a co-host during a live GetStream class or series
 * session (or removes the role). The role is saved — live_hosts for a class,
 * live_session_hosts for that one session — so it survives a rejoin, and is
 * applied to the live call at once, so everyone's room updates immediately.
 *
 * Only the creator can do this (checked by the controllers); co-hosts can't
 * make more co-hosts.
 */

const User = require('../models/User');
const { LiveHost } = require('../models/liveIndex');
const LiveSessionHost = require('../models/LiveSessionHost');
const { getStreamService, GetStreamError } = require('./getStreamService');

/** Validated request: who, and whether to add or remove the role. */
const parseRequest = (body = {}, creatorId) => {
  const userId = Number(body.userId);
  if (!Number.isInteger(userId) || userId <= 0) throw new GetStreamError('Choose who to change', 'INVALID_USER', 400);
  if (userId === creatorId) throw new GetStreamError("You're already the host", 'INVALID_USER', 400);
  if (!['add', 'remove'].includes(body.action)) {
    throw new GetStreamError("action must be 'add' or 'remove'", 'INVALID_ACTION', 400);
  }
  return { userId, makeHost: body.action === 'add' };
};

/**
 * Save the role, then apply it to the call. If the call can't be updated the
 * saved change is undone, so the two never disagree.
 */
const apply = async ({ callId, userId, makeHost, save, undo }) => {
  const user = await User.findByPk(userId, { attributes: ['id', 'firstname', 'lastname'] });
  if (!user) throw new GetStreamError('That person was not found', 'USER_NOT_FOUND', 404);

  const changed = await save();
  try {
    await getStreamService.setCallHost(callId, userId, makeHost);
  } catch (error) {
    if (changed) await undo().catch(() => {});
    console.error('[GetStream Cohost] Call update failed:', error.message);
    throw new GetStreamError("Couldn't update their role. Please try again.", 'COHOST_FAILED', 502);
  }
  const name = `${user.firstname || ''} ${user.lastname || ''}`.trim() || `User ${userId}`;
  return { userId: String(userId), name, isCohost: makeHost };
};

/** Live class: co-hosts are kept in live_hosts (the existing co-host list). */
const setClassCohost = async (liveClass, body) => {
  if (liveClass.status !== 'live' || !liveClass.getstream_call_id) {
    throw new GetStreamError('Co-hosts can be added while the class is live', 'SESSION_NOT_ACTIVE', 400);
  }
  const { userId, makeHost } = parseRequest(body, liveClass.userId);
  const where = { liveClassId: liveClass.id, userId };

  return apply({
    callId: liveClass.getstream_call_id,
    userId,
    makeHost,
    save: async () => {
      if (makeHost) {
        const [, created] = await LiveHost.findOrCreate({ where, defaults: { ...where, role: 'cohost' } });
        return created;
      }
      // Never touches the creator's own row.
      return (await LiveHost.destroy({ where: { ...where, role: 'cohost' } })) > 0;
    },
    undo: () =>
      makeHost ? LiveHost.destroy({ where: { ...where, role: 'cohost' } }) : LiveHost.create({ ...where, role: 'cohost' })
  });
};

/** Series session: co-host for this session only. */
const setSessionCohost = async (session, body) => {
  if (session.status !== 'live') {
    throw new GetStreamError('Co-hosts can be added while the session is live', 'SESSION_NOT_ACTIVE', 400);
  }
  const { userId, makeHost } = parseRequest(body, session.series.userId);
  const where = { sessionId: session.id, userId };

  return apply({
    callId: String(session.id),
    userId,
    makeHost,
    save: async () => {
      if (makeHost) {
        const [, created] = await LiveSessionHost.findOrCreate({ where, defaults: where });
        return created;
      }
      return (await LiveSessionHost.destroy({ where })) > 0;
    },
    undo: () => (makeHost ? LiveSessionHost.destroy({ where }) : LiveSessionHost.create(where))
  });
};

/** Whether someone is a co-host of this series session. */
const isSessionCohost = async (sessionId, userId) =>
  Boolean(await LiveSessionHost.findOne({ where: { sessionId, userId } }));

module.exports = { setClassCohost, setSessionCohost, isSessionCohost, parseRequest };
