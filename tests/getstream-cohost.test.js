/**
 * In-room co-hosts (classes and series sessions) and the "classes with
 * recordings" list. GetStream SDK and models are mocked — needs no database
 * or real credentials.
 */
process.env.STREAM_API_KEY = 'test-key';
process.env.STREAM_API_SECRET = 'test-secret';

const mockUpdateCallMembers = jest.fn().mockResolvedValue({});
const mockListRecordings = jest.fn();
jest.mock('@stream-io/node-sdk', () => ({
  StreamClient: jest.fn().mockImplementation(() => ({
    upsertUsers: jest.fn().mockResolvedValue({}),
    generateCallToken: jest.fn((p) => `token:${p.user_id}:${p.role}`),
    video: {
      call: (_type, id) => ({
        updateCallMembers: (...a) => mockUpdateCallMembers(id, ...a),
        listRecordings: () => mockListRecordings(id)
      })
    }
  }))
}));
jest.mock('../services/liveChatMediaService', () => ({ deleteChatMedia: jest.fn() }));

const mockLiveHosts = [];
const mockSessionHosts = [];
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const mockTable = (rows) => ({
  findOne: jest.fn(async ({ where }) => rows.find((r) => matches(r, where)) || null),
  findOrCreate: jest.fn(async ({ where, defaults }) => {
    const found = rows.find((r) => matches(r, where));
    if (found) return [found, false];
    rows.push({ ...defaults });
    return [defaults, true];
  }),
  create: jest.fn(async (fields) => rows.push({ ...fields })),
  destroy: jest.fn(async ({ where }) => {
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1) && n++;
    return n;
  })
});

const mockClasses = [];
jest.mock('../models/liveIndex', () => ({
  LiveHost: mockTable(mockLiveHosts),
  LiveClass: { findAll: jest.fn(async () => mockClasses) }
}));
jest.mock('../models/LiveSessionHost', () => mockTable(mockSessionHosts));
jest.mock('../models/User', () => ({
  findByPk: jest.fn(async (id) => (id === 404 ? null : { id, firstname: 'Ada', lastname: 'Lovelace' }))
}));

const cohosts = require('../services/getStreamCohostService');
const { listRecordedClasses, _cache } = require('../services/recordedClassesService');

const liveClass = { id: 'class-1', userId: 7, status: 'live', getstream_call_id: 'class-1' };
const session = { id: 'sess-1', status: 'live', series: { userId: 7 } };

beforeEach(() => {
  mockLiveHosts.length = 0;
  mockSessionHosts.length = 0;
  mockClasses.length = 0;
  _cache.clear();
  jest.clearAllMocks();
  mockUpdateCallMembers.mockResolvedValue({});
});

describe('class co-hosts', () => {
  test('add saves the co-host and makes them a host in the call', async () => {
    const result = await cohosts.setClassCohost(liveClass, { userId: 9, action: 'add' });
    expect(result).toEqual({ userId: '9', name: 'Ada Lovelace', isCohost: true });
    expect(mockLiveHosts).toEqual([{ liveClassId: 'class-1', userId: 9, role: 'cohost' }]);
    expect(mockUpdateCallMembers).toHaveBeenCalledWith('class-1', {
      update_members: [{ user_id: '9', role: 'admin' }]
    });
  });

  test('remove deletes the co-host row and makes them a participant', async () => {
    mockLiveHosts.push({ liveClassId: 'class-1', userId: 9, role: 'cohost' });
    await cohosts.setClassCohost(liveClass, { userId: 9, action: 'remove' });
    expect(mockLiveHosts).toHaveLength(0);
    expect(mockUpdateCallMembers).toHaveBeenCalledWith('class-1', {
      update_members: [{ user_id: '9', role: 'user' }]
    });
  });

  test('remove never touches the creator row', async () => {
    mockLiveHosts.push({ liveClassId: 'class-1', userId: 9, role: 'creator' });
    await cohosts.setClassCohost(liveClass, { userId: 9, action: 'remove' });
    expect(mockLiveHosts).toHaveLength(1);
  });

  test('a failed call update undoes the saved change', async () => {
    mockUpdateCallMembers.mockRejectedValueOnce(new Error('stream down'));
    await expect(cohosts.setClassCohost(liveClass, { userId: 9, action: 'add' })).rejects.toMatchObject({ status: 502 });
    expect(mockLiveHosts).toHaveLength(0);
  });

  test.each([
    [{ userId: 7, action: 'add' }, 400], // the creator
    [{ userId: 'x', action: 'add' }, 400],
    [{ userId: 9, action: 'promote' }, 400],
    [{ userId: 404, action: 'add' }, 404]
  ])('rejects %o', async (body, status) => {
    await expect(cohosts.setClassCohost(liveClass, body)).rejects.toMatchObject({ status });
    expect(mockUpdateCallMembers).not.toHaveBeenCalled();
  });

  test('only while the class is live', async () => {
    await expect(
      cohosts.setClassCohost({ ...liveClass, status: 'ended' }, { userId: 9, action: 'add' })
    ).rejects.toMatchObject({ code: 'SESSION_NOT_ACTIVE' });
  });
});

describe('session co-hosts', () => {
  test('add is saved for this session only and applied to its call', async () => {
    await cohosts.setSessionCohost(session, { userId: 9, action: 'add' });
    expect(mockSessionHosts).toEqual([{ sessionId: 'sess-1', userId: 9 }]);
    expect(await cohosts.isSessionCohost('sess-1', 9)).toBe(true);
    expect(await cohosts.isSessionCohost('sess-2', 9)).toBe(false);
    expect(mockUpdateCallMembers).toHaveBeenCalledWith('sess-1', {
      update_members: [{ user_id: '9', role: 'admin' }]
    });
  });

  test('remove', async () => {
    mockSessionHosts.push({ sessionId: 'sess-1', userId: 9 });
    await cohosts.setSessionCohost(session, { userId: 9, action: 'remove' });
    expect(mockSessionHosts).toHaveLength(0);
  });
});

describe('recorded classes', () => {
  const ended = (id, callId = id) => ({ id, title: `Class ${id}`, startTime: null, updatedAt: null, getstream_call_id: callId });

  test('lists only classes with a recording in any session', async () => {
    mockClasses.push(ended('a'), ended('b'), ended('c', 'c-2'));
    mockListRecordings.mockImplementation(async (callId) => ({
      recordings: callId === 'a' || callId === 'c' ? [{ filename: 'x.mp4', url: 'u', start_time: 1, end_time: 2 }] : []
    }));
    const list = await listRecordedClasses(7);
    expect(list.map((c) => c.id)).toEqual(['a', 'c']);
  });

  test('keeps a class GetStream could not be asked about', async () => {
    mockClasses.push(ended('a'));
    mockListRecordings.mockRejectedValue(new Error('stream down'));
    expect((await listRecordedClasses(7)).map((c) => c.id)).toEqual(['a']);
  });

  test('remembers results between requests', async () => {
    mockClasses.push(ended('a'));
    mockListRecordings.mockResolvedValue({ recordings: [{ filename: 'x', url: 'u', start_time: 1, end_time: 2 }] });
    await listRecordedClasses(7);
    await listRecordedClasses(7);
    expect(mockListRecordings).toHaveBeenCalledTimes(1);
  });
});
