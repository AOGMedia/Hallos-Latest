/**
 * Live class recovery: host heartbeat rules and room reuse on restart.
 * Pure/mocked — needs no database or real ZegoCloud credentials.
 */
process.env.ZEGO_APP_ID = process.env.ZEGO_APP_ID || '123456789';
process.env.ZEGO_SERVER_SECRET = process.env.ZEGO_SERVER_SECRET || '0123456789abcdef0123456789abcdef';

const { decideHeartbeatAction, applyHostHeartbeat, RECOVERY_WINDOW_MS } = require('../services/liveRecoveryService');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const ROOM = 'live_abc_1_x';

function fakeClass(overrides = {}) {
  return {
    id: 'class-1',
    status: 'live',
    endTime: null,
    zego_room_id: ROOM,
    changed: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('decideHeartbeatAction', () => {
  test('live class is touched', () => {
    expect(decideHeartbeatAction(fakeClass(), ROOM, NOW)).toBe('touch');
  });

  test('recently ended class in the same room is reopened', () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW - 60_000) });
    expect(decideHeartbeatAction(lc, ROOM, NOW)).toBe('reopen');
  });

  test('ended exactly at the window edge is still reopened', () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW - RECOVERY_WINDOW_MS) });
    expect(decideHeartbeatAction(lc, ROOM, NOW)).toBe('reopen');
  });

  test('ended longer ago than the window is left alone', () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW - RECOVERY_WINDOW_MS - 1) });
    expect(decideHeartbeatAction(lc, ROOM, NOW)).toBe('none');
  });

  test('host reporting a different room never reopens', () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW - 60_000) });
    expect(decideHeartbeatAction(lc, 'some_other_room', NOW)).toBe('none');
  });

  test('missing room id never reopens', () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW - 60_000) });
    expect(decideHeartbeatAction(lc, undefined, NOW)).toBe('none');
  });

  test('ended class without an end time is left alone', () => {
    expect(decideHeartbeatAction(fakeClass({ status: 'ended', endTime: null }), ROOM, NOW)).toBe('none');
  });

  test('scheduled / recorded / archived classes are never changed', () => {
    for (const status of ['scheduled', 'recorded', 'archived']) {
      expect(decideHeartbeatAction(fakeClass({ status }), ROOM, NOW)).toBe('none');
    }
  });

  test('end time in the future (clock skew) is not treated as recent', () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW + 60_000) });
    expect(decideHeartbeatAction(lc, ROOM, NOW)).toBe('none');
  });
});

describe('applyHostHeartbeat', () => {
  test('touch bumps only updatedAt', async () => {
    const lc = fakeClass();
    await expect(applyHostHeartbeat(lc, ROOM, NOW)).resolves.toEqual({ status: 'live', recovered: false });
    expect(lc.changed).toHaveBeenCalledWith('updatedAt', true);
    expect(lc.save).toHaveBeenCalledWith({ fields: ['updatedAt'] });
    expect(lc.update).not.toHaveBeenCalled();
  });

  test('reopen sets the class live and clears the end time', async () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW - 30_000) });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(applyHostHeartbeat(lc, ROOM, NOW)).resolves.toEqual({ status: 'live', recovered: true });
    expect(lc.update).toHaveBeenCalledWith({ status: 'live', endTime: null });
  });

  test('no-op leaves the class untouched', async () => {
    const lc = fakeClass({ status: 'ended', endTime: new Date(NOW - RECOVERY_WINDOW_MS * 2) });
    await expect(applyHostHeartbeat(lc, ROOM, NOW)).resolves.toEqual({ status: 'ended', recovered: false });
    expect(lc.update).not.toHaveBeenCalled();
    expect(lc.save).not.toHaveBeenCalled();
  });
});

describe('zegoCloudService.startLiveSession room reuse', () => {
  const mockFindByPk = jest.fn();
  jest.mock('../models/liveIndex', () => ({ LiveClass: { findByPk: (...a) => mockFindByPk(...a) } }));
  const { zegoCloudService } = require('../services/zegoCloudService');

  beforeEach(() => mockFindByPk.mockReset());
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

  test('restarting an ended class reuses its existing room', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindByPk.mockResolvedValue({ status: 'ended', zego_room_id: ROOM, max_participants: 50, update });

    const result = await zegoCloudService.startLiveSession('class-1', 42);

    expect(result.roomId).toBe(ROOM);
    expect(typeof result.creatorToken).toBe('string');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ zego_room_id: ROOM, status: 'live' }));
  });

  test('first start of a class still creates a fresh room', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindByPk.mockResolvedValue({ status: 'scheduled', zego_room_id: null, max_participants: 50, update });

    const result = await zegoCloudService.startLiveSession('class-2', 42);

    expect(result.roomId).toMatch(/^live_class-2_\d+_[a-z0-9]+$/);
  });

  test('starting an already-live class is still refused', async () => {
    mockFindByPk.mockResolvedValue({ status: 'live', zego_room_id: ROOM, update: jest.fn() });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(zegoCloudService.startLiveSession('class-1', 42)).rejects.toThrow();
  });
});
