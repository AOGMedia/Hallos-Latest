/**
 * GetStream live classes: service behaviour and heartbeat recovery.
 * The GetStream SDK is mocked — needs no database or real credentials.
 */
process.env.STREAM_API_KEY = 'test-key';
process.env.STREAM_API_SECRET = 'test-secret';

const mockCalls = new Map();
const mockUpsertUsers = jest.fn().mockResolvedValue({});
const mockGenerateCallToken = jest.fn((payload) => `token:${payload.user_id}:${payload.role}`);

function mockCall(id) {
  if (!mockCalls.has(id)) {
    const state = { ended: false, created: false };
    mockCalls.set(id, {
      state,
      getOrCreate: jest.fn(async () => {
        state.created = true;
        return { call: { id, ended_at: state.ended ? new Date() : null } };
      }),
      end: jest.fn(async () => {
        state.ended = true;
      }),
      updateCallMembers: jest.fn().mockResolvedValue({}),
      startRecording: jest.fn().mockResolvedValue({}),
      stopRecording: jest.fn().mockResolvedValue({}),
      listRecordings: jest.fn(async () => ({
        recordings: state.created
          ? [{ filename: `${id}.mp4`, url: `https://cdn/${id}.mp4`, start_time: new Date(), end_time: new Date() }]
          : []
      }))
    });
  }
  return mockCalls.get(id);
}

jest.mock('../services/liveChatMediaService', () => ({
  deleteChatMedia: jest.fn().mockResolvedValue(0)
}));

jest.mock('@stream-io/node-sdk', () => ({
  StreamClient: jest.fn().mockImplementation(() => ({
    upsertUsers: mockUpsertUsers,
    generateCallToken: mockGenerateCallToken,
    video: { call: (_type, id) => mockCall(id) }
  }))
}));

const { getStreamService, callIdFor, sessionNumberOf } = require('../services/getStreamService');
const { decideHeartbeatAction } = require('../services/liveRecoveryService');

const CLASS_ID = '0b6c7c5e-1111-4222-8333-944455556666';
const host = { id: 7, firstname: 'Ada', lastname: 'Host' };
const viewer = { id: 9, firstname: 'Bo', lastname: 'Viewer' };

function fakeClass(overrides = {}) {
  const lc = {
    id: CLASS_ID,
    status: 'scheduled',
    streaming_provider: 'getstream',
    getstream_call_id: null,
    max_participants: 50,
    update: jest.fn(async (fields) => Object.assign(lc, fields)),
    ...overrides
  };
  return lc;
}

beforeEach(() => {
  mockCalls.clear();
  jest.clearAllMocks();
});

describe('call ids', () => {
  test('session 1 uses the class id; later sessions are suffixed', () => {
    expect(callIdFor(CLASS_ID, 1)).toBe(CLASS_ID);
    expect(callIdFor(CLASS_ID, 3)).toBe(`${CLASS_ID}-3`);
    expect(sessionNumberOf(CLASS_ID, null)).toBe(1);
    expect(sessionNumberOf(CLASS_ID, CLASS_ID)).toBe(1);
    expect(sessionNumberOf(CLASS_ID, `${CLASS_ID}-3`)).toBe(3);
  });

  test('call ids stay within GetStream\'s 64 character limit', () => {
    expect(callIdFor(CLASS_ID, 999).length).toBeLessThanOrEqual(64);
  });
});

describe('startSession', () => {
  test('creates the call, marks the class live and gives the creator a host token for that call only', async () => {
    const lc = fakeClass();
    const result = await getStreamService.startSession(lc, host);

    expect(lc.status).toBe('live');
    expect(lc.getstream_call_id).toBe(CLASS_ID);
    expect(result.alreadyLive).toBe(false);
    expect(result.apiKey).toBe('test-key');
    expect(mockGenerateCallToken).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: '7', role: 'admin', call_cids: [`default:${CLASS_ID}`] })
    );
    const created = mockCall(CLASS_ID).getOrCreate.mock.calls[0][0].data;
    expect(created.settings_override.recording.mode).toBe('available');
    expect(created.members).toEqual([{ user_id: '7', role: 'admin' }]);
  });

  test('is safe to repeat while live (no new call)', async () => {
    const lc = fakeClass({ status: 'live', getstream_call_id: CLASS_ID });
    const result = await getStreamService.startSession(lc, host);
    expect(result.alreadyLive).toBe(true);
    expect(result.callId).toBe(CLASS_ID);
    expect(lc.update).not.toHaveBeenCalled();
  });

  test('restarting a wrongly-ended class reuses its still-open call', async () => {
    const lc = fakeClass({ status: 'ended', getstream_call_id: CLASS_ID });
    const result = await getStreamService.startSession(lc, host);
    expect(result.callId).toBe(CLASS_ID);
  });

  test('restarting after a deliberate end moves to a fresh call', async () => {
    mockCall(CLASS_ID).state.ended = true;
    const lc = fakeClass({ status: 'ended', getstream_call_id: CLASS_ID });
    const result = await getStreamService.startSession(lc, host);
    expect(result.callId).toBe(`${CLASS_ID}-2`);
    expect(lc.getstream_call_id).toBe(`${CLASS_ID}-2`);
  });
});

describe('joinSession', () => {
  test('refuses a class that is not live, with the wording the room page retries on', async () => {
    await expect(getStreamService.joinSession(fakeClass(), viewer, { isHost: false })).rejects.toMatchObject({
      message: 'Live class is not currently active',
      status: 400
    });
  });

  test('participants get a user-role token; co-hosts are promoted to host in the call', async () => {
    const lc = fakeClass({ status: 'live', getstream_call_id: CLASS_ID });

    await getStreamService.joinSession(lc, viewer, { isHost: false });
    expect(mockGenerateCallToken).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: '9', role: 'user' }));
    expect(mockCall(CLASS_ID).updateCallMembers).not.toHaveBeenCalled();

    await getStreamService.joinSession(lc, viewer, { isHost: true });
    expect(mockGenerateCallToken).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: '9', role: 'admin' }));
    expect(mockCall(CLASS_ID).updateCallMembers).toHaveBeenCalledWith({
      update_members: [{ user_id: '9', role: 'admin' }]
    });
  });
});

describe('endSession', () => {
  test('ends the call and the class', async () => {
    const lc = fakeClass({ status: 'live', getstream_call_id: CLASS_ID });
    await getStreamService.endSession(lc);
    expect(mockCall(CLASS_ID).end).toHaveBeenCalled();
    expect(lc.status).toBe('ended');
    expect(lc.endTime).toBeInstanceOf(Date);
  });
});

describe('recordings', () => {
  test('start/stop use composite recording on the current call', async () => {
    const lc = fakeClass({ status: 'live', getstream_call_id: CLASS_ID });
    await getStreamService.setRecording(lc, 'start');
    await getStreamService.setRecording(lc, 'stop');
    expect(mockCall(CLASS_ID).startRecording).toHaveBeenCalledWith({ recording_type: 'composite' });
    expect(mockCall(CLASS_ID).stopRecording).toHaveBeenCalledWith({ recording_type: 'composite' });
  });

  test('"no active session" from GetStream is reported clearly', async () => {
    const lc = fakeClass({ status: 'live', getstream_call_id: CLASS_ID });
    mockCall(CLASS_ID).startRecording.mockRejectedValueOnce(new Error('StartRecording failed with error: "there is no active session"'));
    await expect(getStreamService.setRecording(lc, 'start')).rejects.toMatchObject({ code: 'NO_ACTIVE_SESSION', status: 409 });
  });

  test('lists recordings from every session of the class', async () => {
    mockCall(CLASS_ID).state.created = true;
    mockCall(`${CLASS_ID}-2`).state.created = true;
    const lc = fakeClass({ status: 'ended', getstream_call_id: `${CLASS_ID}-2` });
    const recordings = await getStreamService.listRecordings(lc);
    expect(recordings.map((r) => r.session).sort()).toEqual([1, 2]);
  });
});

describe('series sessions', () => {
  const SESSION_ID = '5a5a5a5a-1111-4222-8333-944455556666';
  const series = { id: 'series-1', maxParticipants: 30, title: 'Series' };

  function fakeSession(overrides = {}) {
    const s = {
      id: SESSION_ID,
      sessionNumber: 4,
      status: 'scheduled',
      update: jest.fn(async (fields) => Object.assign(s, fields)),
      ...overrides
    };
    return s;
  }

  test('starting a scheduled session opens a call named after the session and goes live', async () => {
    const session = fakeSession();
    const result = await getStreamService.startSeriesSession(session, series, host);

    expect(result.callId).toBe(SESSION_ID);
    expect(result.alreadyLive).toBe(false);
    expect(session.status).toBe('live');
    expect(session.actualStartTime).toBeInstanceOf(Date);
    const created = mockCall(SESSION_ID).getOrCreate.mock.calls[0][0].data;
    expect(created.settings_override.limits.max_participants).toBe(30);
    expect(created.custom).toEqual({ live_series_id: 'series-1', live_session_id: SESSION_ID });
  });

  test('starting a live session again just returns fresh host credentials', async () => {
    const session = fakeSession({ status: 'live' });
    const result = await getStreamService.startSeriesSession(session, series, host);
    expect(result.alreadyLive).toBe(true);
    expect(session.update).not.toHaveBeenCalled();
    expect(mockCall(SESSION_ID).getOrCreate).not.toHaveBeenCalled();
  });

  test('an ended session cannot be restarted (same rule as ZegoCloud)', async () => {
    await expect(
      getStreamService.startSeriesSession(fakeSession({ status: 'ended' }), series, host)
    ).rejects.toMatchObject({ status: 400, code: 'SESSION_NOT_STARTABLE' });
  });

  test('joining needs a live session; participants get a user-role token for that call only', async () => {
    await expect(
      getStreamService.joinSeriesSession(fakeSession(), viewer, { isHost: false })
    ).rejects.toMatchObject({ status: 400 });

    const creds = await getStreamService.joinSeriesSession(fakeSession({ status: 'live' }), viewer, { isHost: false });
    expect(creds.callId).toBe(SESSION_ID);
    expect(mockGenerateCallToken).toHaveBeenLastCalledWith(
      expect.objectContaining({ user_id: '9', role: 'user', call_cids: [`default:${SESSION_ID}`] })
    );
  });

  test('ending ends the call and the session', async () => {
    const session = fakeSession({ status: 'live' });
    await getStreamService.endSeriesSession(session);
    expect(mockCall(SESSION_ID).end).toHaveBeenCalled();
    expect(session.status).toBe('ended');
    expect(session.actualEndTime).toBeInstanceOf(Date);
  });

  test('recordings are listed for the session\'s call', async () => {
    mockCall(SESSION_ID).state.created = true;
    const recordings = await getStreamService.listSeriesSessionRecordings(fakeSession({ status: 'ended' }));
    expect(recordings).toHaveLength(1);
    expect(recordings[0].session).toBe(4);
  });
});

describe('series provider choice', () => {
  const { seriesProviderOf, resolveSeriesProvider } = require('../utils/liveProviders');

  test('series created before the choice existed are ZegoCloud', () => {
    expect(seriesProviderOf({})).toBe('zegocloud');
    expect(seriesProviderOf({ streamingProvider: 'getstream' })).toBe('getstream');
  });

  test('defaults to ZegoCloud and rejects unknown providers', () => {
    expect(resolveSeriesProvider(undefined)).toEqual({ provider: 'zegocloud' });
    expect(resolveSeriesProvider('mux').error).toMatch(/Invalid streaming provider/);
  });

  test('GetStream is refused until its schema is ready', () => {
    // ensureGetStreamSupport hasn't run in tests, so the series column isn't verified.
    expect(resolveSeriesProvider('getstream').error).toMatch(/not available yet/);
  });
});

describe('heartbeat recovery for GetStream classes', () => {
  const NOW = Date.parse('2026-10-28T12:00:00Z');

  test('reopens a recently ended class when the host reports its current call', () => {
    const lc = fakeClass({ status: 'ended', getstream_call_id: CLASS_ID, endTime: new Date(NOW - 60_000) });
    expect(decideHeartbeatAction(lc, CLASS_ID, NOW)).toBe('reopen');
  });

  test('ignores a host reporting an old call', () => {
    const lc = fakeClass({ status: 'ended', getstream_call_id: `${CLASS_ID}-2`, endTime: new Date(NOW - 60_000) });
    expect(decideHeartbeatAction(lc, CLASS_ID, NOW)).toBe('none');
  });

  test('ZegoCloud classes still match on their room id', () => {
    const lc = { status: 'ended', streaming_provider: 'zegocloud', zego_room_id: 'room-1', getstream_call_id: 'room-1', endTime: new Date(NOW - 60_000) };
    expect(decideHeartbeatAction(lc, 'room-1', NOW)).toBe('reopen');
    expect(decideHeartbeatAction({ ...lc, zego_room_id: 'room-2' }, 'room-1', NOW)).toBe('none');
  });
});
