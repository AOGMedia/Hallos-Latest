/**
 * GetStream Video — the second live class provider, next to ZegoCloud.
 *
 * Self-contained: nothing here is used by ZegoCloud flows, and nothing in the
 * ZegoCloud services is changed by it. Credentials stay on the server; the
 * browser only ever receives the public API key and a short-lived token that
 * is limited to one call.
 *
 * Calls use Stream's "default" call type (interactive: everyone can use their
 * camera and microphone). Each live class maps to a call id derived from the
 * class id — `<classId>` first, then `<classId>-2`, `-3`, … when an ended call
 * is restarted (Stream doesn't let people back into an ended call). Because
 * the ids are predictable, every session's recordings can be listed later
 * without storing any history.
 */

const CALL_TYPE = 'default';
const TOKEN_VALIDITY_SECONDS = 6 * 60 * 60;
const RECORDING_TYPE = 'composite';
/** Call role with full in-call permissions (screen share, mute others, record). */
const HOST_CALL_ROLE = 'admin';
const PARTICIPANT_CALL_ROLE = 'user';

class GetStreamError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'GetStreamError';
    this.code = code;
    this.status = status;
  }
}

let client = null;

const isConfigured = () => Boolean(process.env.STREAM_API_KEY && process.env.STREAM_API_SECRET);

const getClient = () => {
  if (!isConfigured()) {
    throw new GetStreamError('GetStream is not configured on the server', 'GETSTREAM_NOT_CONFIGURED', 503);
  }
  if (!client) {
    // Loaded on first use, so the live routes (shared with ZegoCloud) never
    // depend on this SDK being loadable.
    const { StreamClient } = require('@stream-io/node-sdk');
    client = new StreamClient(process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET, { timeout: 10000 });
  }
  return client;
};

const streamUserId = (userId) => String(userId);

/** `<classId>` for session 1, `<classId>-<n>` after that. */
const callIdFor = (liveClassId, sessionNumber) =>
  sessionNumber <= 1 ? String(liveClassId) : `${liveClassId}-${sessionNumber}`;

/** Which session a stored call id belongs to (1 if none yet). */
const sessionNumberOf = (liveClassId, callId) => {
  if (!callId || callId === String(liveClassId)) return 1;
  const n = Number(String(callId).slice(String(liveClassId).length + 1));
  return Number.isInteger(n) && n > 1 ? n : 1;
};

const isNotFound = (error) => error && (error.code === 16 || error.status === 404 || /not.?found/i.test(error.message || ''));

const upsertUser = async (user) => {
  const name = user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() : '';
  await getClient().upsertUsers([{ id: streamUserId(user.id), name: name || `User ${user.id}` }]);
};

/**
 * Get or create the call for the class's current session. If that call was
 * ended (a deliberate "end class"), move on to the next session's call.
 */
const ensureActiveCall = async (liveClass, creator) => {
  const video = getClient().video;
  let sessionNumber = sessionNumberOf(liveClass.id, liveClass.getstream_call_id);

  // Bounded: one step past an ended call is always a fresh one.
  for (let attempt = 0; attempt < 3; attempt++) {
    const callId = callIdFor(liveClass.id, sessionNumber);
    const call = video.call(CALL_TYPE, callId);
    const response = await call.getOrCreate({
      data: {
        created_by_id: streamUserId(creator.id),
        members: [{ user_id: streamUserId(creator.id), role: HOST_CALL_ROLE }],
        custom: { live_class_id: String(liveClass.id) },
        settings_override: {
          recording: { mode: 'available', quality: '720p' },
          ...(liveClass.max_participants ? { limits: { max_participants: liveClass.max_participants } } : {})
        }
      }
    });
    if (!response.call || !response.call.ended_at) return callId;
    sessionNumber += 1;
  }
  throw new GetStreamError('Could not open a new GetStream call', 'CALL_CREATE_FAILED', 502);
};

/** Credentials the browser needs to join one call. */
const credentialsFor = (callId, userId, isHost) => ({
  apiKey: process.env.STREAM_API_KEY,
  callType: CALL_TYPE,
  callId,
  token: getClient().generateCallToken({
    user_id: streamUserId(userId),
    call_cids: [`${CALL_TYPE}:${callId}`],
    role: isHost ? HOST_CALL_ROLE : PARTICIPANT_CALL_ROLE,
    validity_in_seconds: TOKEN_VALIDITY_SECONDS
  }),
  userId: streamUserId(userId)
});

/**
 * Creator starts (or rejoins) the class. Safe to repeat: an already-live class
 * keeps its call and the creator just gets fresh credentials.
 */
const startSession = async (liveClass, creator) => {
  await upsertUser(creator);

  if (liveClass.status === 'live' && liveClass.getstream_call_id) {
    return { alreadyLive: true, ...credentialsFor(liveClass.getstream_call_id, creator.id, true) };
  }

  const callId = await ensureActiveCall(liveClass, creator);
  await liveClass.update({ status: 'live', getstream_call_id: callId });
  console.log(`[GetStream] Live session started: ${liveClass.id} on call ${callId}`);
  return { alreadyLive: false, ...credentialsFor(callId, creator.id, true) };
};

/** A participant (or co-host) joins a live class's current call. */
const joinSession = async (liveClass, user, { isHost }) => {
  if (liveClass.status !== 'live' || !liveClass.getstream_call_id) {
    // Same wording as ZegoCloud so the room page's retry logic applies.
    throw new GetStreamError('Live class is not currently active', 'SESSION_NOT_ACTIVE', 400);
  }
  await upsertUser(user);
  if (isHost) {
    await getClient().video.call(CALL_TYPE, liveClass.getstream_call_id).updateCallMembers({
      update_members: [{ user_id: streamUserId(user.id), role: HOST_CALL_ROLE }]
    });
  }
  return credentialsFor(liveClass.getstream_call_id, user.id, isHost);
};

/** End the class for everyone. Ending the call also stops any recording. */
const endSession = async (liveClass) => {
  if (liveClass.getstream_call_id) {
    try {
      await getClient().video.call(CALL_TYPE, liveClass.getstream_call_id).end();
    } catch (error) {
      // Already ended or never created: the class still ends.
      if (!isNotFound(error) && !/ended/i.test(error.message || '')) throw error;
    }
  }
  if (liveClass.status === 'live') {
    await liveClass.update({ status: 'ended', endTime: new Date() });
  }
  console.log(`[GetStream] Live session ended: ${liveClass.id}`);
  return { liveClassId: liveClass.id, endedAt: new Date() };
};

/** Start or stop the composite recording of the current call (server-side, so only the host can). */
const setRecording = async (liveClass, action) => {
  if (liveClass.status !== 'live' || !liveClass.getstream_call_id) {
    throw new GetStreamError('Live class is not currently active', 'SESSION_NOT_ACTIVE', 400);
  }
  const call = getClient().video.call(CALL_TYPE, liveClass.getstream_call_id);
  try {
    if (action === 'start') {
      await call.startRecording({ recording_type: RECORDING_TYPE });
    } else {
      await call.stopRecording({ recording_type: RECORDING_TYPE });
    }
  } catch (error) {
    const message = error.message || '';
    // GetStream records the call's media, so someone has to be connected.
    if (/no active session/i.test(message)) {
      throw new GetStreamError('Recording can start once you are connected to the class', 'NO_ACTIVE_SESSION', 409);
    }
    if (/already/i.test(message)) {
      throw new GetStreamError('Recording is already running', 'RECORDING_STATE', 409);
    }
    if (/egress is not running|not (being )?record/i.test(message)) {
      throw new GetStreamError('Recording is not running', 'RECORDING_STATE', 409);
    }
    throw error;
  }
  return { recording: action === 'start' };
};

/**
 * Every recording across all of the class's sessions, newest first. URLs are
 * signed by GetStream and expire, so they're fetched fresh on each request.
 */
const listRecordings = async (liveClass) => {
  const video = getClient().video;
  const lastSession = sessionNumberOf(liveClass.id, liveClass.getstream_call_id);
  const recordings = [];

  for (let session = 1; session <= lastSession; session++) {
    const callId = callIdFor(liveClass.id, session);
    try {
      const response = await video.call(CALL_TYPE, callId).listRecordings();
      for (const rec of response.recordings || []) {
        recordings.push({
          session,
          callId,
          filename: rec.filename,
          url: rec.url,
          startTime: rec.start_time,
          endTime: rec.end_time
        });
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  return recordings.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
};

module.exports = {
  getStreamService: {
    isConfigured,
    startSession,
    joinSession,
    endSession,
    setRecording,
    listRecordings
  },
  GetStreamError,
  // Exported for tests.
  callIdFor,
  sessionNumberOf
};
