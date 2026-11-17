/**
 * Editing a live class (PUT /api/live/:id): who may edit, what can change
 * when, validation, and that a new time tells attendees. Models are mocked —
 * needs no database.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../services/muxLiveService', () => ({}));
jest.mock('../models/User', () => ({}));
jest.mock('../models/liveIndex', () => ({
  LiveClass: { findByPk: jest.fn() },
  LiveHost: {},
  LiveAttendee: {}
}));
jest.mock('../utils/liveProviders', () => ({ isGetStreamAvailable: jest.fn(() => true) }));
jest.mock('../services/liveClassScheduleNotifier', () => ({
  notifyLiveClassRescheduled: jest.fn(async () => 2)
}));

const { LiveClass } = require('../models/liveIndex');
const { isGetStreamAvailable } = require('../utils/liveProviders');
const { notifyLiveClassRescheduled } = require('../services/liveClassScheduleNotifier');
const controller = require('../controllers/liveController');

const inDays = (n, hour = 19) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

const makeClass = (overrides = {}) => {
  const row = {
    id: 'class-1',
    userId: 7,
    title: 'Intro to Figma',
    description: 'Basics',
    price: '0.00',
    currency: 'NGN',
    category: 'Design',
    privacy: 'public',
    status: 'scheduled',
    streaming_provider: 'zegocloud',
    max_participants: 50,
    thumbnailUrl: null,
    startTime: inDays(3, 19),
    endTime: inDays(3, 20),
    ...overrides,
    update: jest.fn(async (changes) => {
      Object.assign(row, changes);
      Object.assign(row.dataValues, changes);
      return row;
    }),
    getDualPricing: () => ({})
  };
  row.dataValues = { ...row };
  return row;
};

const run = async (liveClass, body, { userId = 7, files } = {}) => {
  LiveClass.findByPk.mockResolvedValue(liveClass);
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  await controller.updateLiveClass({ params: { id: 'class-1' }, user: { id: userId }, body, files }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('404 for a class that does not exist', async () => {
  const res = await run(null, { title: 'x' });
  expect(res.statusCode).toBe(404);
});

test('only the creator can edit', async () => {
  const c = makeClass();
  const res = await run(c, { title: 'Hijacked' }, { userId: 99 });
  expect(res.statusCode).toBe(403);
  expect(c.update).not.toHaveBeenCalled();
});

test('saves the details without touching the time or emailing anyone', async () => {
  const c = makeClass();
  const res = await run(c, {
    title: '  Figma for beginners ',
    description: 'Updated',
    price: '2500',
    category: 'Graphics Design',
    privacy: 'private',
    maxParticipants: '80',
    // The form sends the current times back unchanged.
    startTime: c.startTime.toISOString(),
    endTime: c.endTime.toISOString()
  });
  expect(res.statusCode).toBe(200);
  expect(c.update).toHaveBeenCalledWith({
    title: 'Figma for beginners',
    description: 'Updated',
    price: 2500,
    category: 'Graphics Design',
    privacy: 'private',
    max_participants: 80
  });
  expect(res.body).toMatchObject({ success: true, rescheduled: false, attendeesNotified: 0 });
  expect(notifyLiveClassRescheduled).not.toHaveBeenCalled();
});

test('a new date and time is saved and attendees are told', async () => {
  const c = makeClass();
  const start = inDays(5, 10);
  const end = inDays(5, 12);
  const res = await run(c, { startTime: start.toISOString(), endTime: end.toISOString() });
  expect(res.statusCode).toBe(200);
  expect(c.startTime.getTime()).toBe(start.getTime());
  expect(c.endTime.getTime()).toBe(end.getTime());
  expect(notifyLiveClassRescheduled).toHaveBeenCalledWith(c);
  expect(res.body).toMatchObject({ rescheduled: true, attendeesNotified: 2 });
  expect(res.body.message).toMatch(/2 attendees will get an email/);
});

test('the save still succeeds when notifying fails', async () => {
  notifyLiveClassRescheduled.mockRejectedValueOnce(new Error('smtp down'));
  const c = makeClass();
  const res = await run(c, { startTime: inDays(6).toISOString(), endTime: inDays(6, 21).toISOString() });
  expect(res.statusCode).toBe(200);
  expect(res.body.message).toBe('Class updated with the new time.');
});

test.each([
  ['live', 'the class is live'],
  ['ended', 'the class is over']
])('the time cannot change when %s (%s), but details still can', async (status) => {
  const c = makeClass({ status });
  const moved = await run(c, { startTime: inDays(9).toISOString(), endTime: inDays(9, 21).toISOString() });
  expect(moved.statusCode).toBe(409);
  expect(c.update).not.toHaveBeenCalled();

  const renamed = await run(c, { title: 'Recording: Intro to Figma' });
  expect(renamed.statusCode).toBe(200);
  expect(c.title).toBe('Recording: Intro to Figma');
});

test.each([
  [{ title: '   ' }, 400, /Title is required/],
  [{ price: '-5' }, 400, /zero or more/],
  [{ price: 'abc' }, 400, /zero or more/],
  [{ privacy: 'friends' }, 400, /public or private/],
  [{ maxParticipants: '0' }, 400, /between 1 and 1000/],
  [{ maxParticipants: '5000' }, 400, /between 1 and 1000/],
  [{ startTime: 'not a date' }, 400, /Invalid date/],
  [{ startTime: '2001-01-01T10:00:00.000Z' }, 400, /past/]
])('rejects %j', async (body, status, message) => {
  const c = makeClass();
  const res = await run(c, body);
  expect(res.statusCode).toBe(status);
  expect(res.body.message).toMatch(message);
  expect(c.update).not.toHaveBeenCalled();
});

test('end time must be after the start time (also when only one is sent)', async () => {
  const c = makeClass();
  const both = await run(c, { startTime: inDays(4, 15).toISOString(), endTime: inDays(4, 14).toISOString() });
  expect(both.statusCode).toBe(400);
  const onlyEnd = await run(c, { endTime: inDays(3, 18).toISOString() }); // before the saved 19:00 start
  expect(onlyEnd.statusCode).toBe(400);
  expect(onlyEnd.body.message).toMatch(/after start time/);
});

test('streaming method switches between in-app providers while scheduled', async () => {
  const c = makeClass();
  const res = await run(c, { streamingProvider: 'getstream' });
  expect(res.statusCode).toBe(200);
  expect(c.streaming_provider).toBe('getstream');
});

test('streaming method is refused when GetStream is off, for Mux, or once started', async () => {
  isGetStreamAvailable.mockReturnValueOnce(false);
  expect((await run(makeClass(), { streamingProvider: 'getstream' })).statusCode).toBe(400);
  expect((await run(makeClass({ streaming_provider: 'mux' }), { streamingProvider: 'zegocloud' })).statusCode).toBe(400);
  expect((await run(makeClass(), { streamingProvider: 'mux' })).statusCode).toBe(400);
  expect((await run(makeClass({ status: 'live' }), { streamingProvider: 'getstream' })).statusCode).toBe(409);
  // Sending the current provider is not a change.
  expect((await run(makeClass({ status: 'live' }), { streamingProvider: 'zegocloud' })).statusCode).toBe(200);
});

test('a new thumbnail upload replaces the old one', async () => {
  const c = makeClass({ thumbnailUrl: 'https://cdn.example.com/old.png' });
  const res = await run(c, {}, { files: { thumbnailUrl: [{ location: 'https://cdn.example.com/new.png' }] } });
  expect(res.statusCode).toBe(200);
  expect(c.thumbnailUrl).toBe('https://cdn.example.com/new.png');
});
