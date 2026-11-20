/**
 * Class feedback, stage 2: who attended, the end-screen link (only after the
 * class, only for people who were in it), and the emails that follow — sent
 * once, after the class ends, never to anyone who already answered.
 * Database and models are mocked.
 */
process.env.JWT_SECRET_KEY = 'test-secret';
process.env.CLIENT_URL = 'https://hallos.net';

const mockAttendance = new Map(); // `${kind}:${id}` -> [{ userId, role }]
const mockResponses = new Map(); // `${kind}:${id}:${userId}` -> { overall }
const mockClasses = new Map();
const mockQueries = [];
let mockReady = true;
let mockDue = [];

jest.mock('../config/db', () => ({
  query: jest.fn(async (sql, { replacements: r = {} } = {}) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    mockQueries.push({ sql: s, r });
    if (s.startsWith('INSERT INTO live_room_attendance')) {
      const list = mockAttendance.get(`${r.kind}:${r.targetId}`) || [];
      const found = list.find((a) => a.userId === r.userId);
      if (found) found.role = r.role === 'host' ? 'host' : found.role;
      else list.push({ userId: r.userId, role: r.role });
      mockAttendance.set(`${r.kind}:${r.targetId}`, list);
      return [[]];
    }
    if (s.startsWith('SELECT user_id AS "userId", role FROM live_room_attendance')) {
      return [mockAttendance.get(`${r.kind}:${r.targetId}`) || []];
    }
    if (s.startsWith('SELECT role FROM live_room_attendance')) {
      const a = (mockAttendance.get(`${r.kind}:${r.targetId}`) || []).find((x) => x.userId === r.userId);
      return [a ? [{ role: a.role }] : []];
    }
    if (s.startsWith('SELECT overall')) {
      const row = mockResponses.get(`${r.kind}:${r.targetId}:${r.userId}`);
      return [row ? [row] : []];
    }
    if (s.startsWith('SELECT user_id AS "userId" FROM class_feedback')) {
      const ids = [...mockResponses.keys()]
        .filter((k) => k.startsWith(`${r.kind}:${r.targetId}:`))
        .map((k) => ({ userId: Number(k.split(':')[2]) }));
      return [ids];
    }
    if (s.startsWith('INSERT INTO class_feedback_dispatch')) return [[]];
    if (s.startsWith('UPDATE class_feedback_dispatch d SET claimed_at')) {
      const due = mockDue;
      mockDue = [];
      return [due];
    }
    return [[]];
  })
}));
jest.mock('../utils/ensureClassFeedback', () => ({ isClassFeedbackReady: () => mockReady }));
jest.mock('../models/User', () => ({}));
jest.mock('../models/liveIndex', () => ({
  LiveClass: { findByPk: jest.fn(async (id) => mockClasses.get(id) || null) }
}));
jest.mock('../models/liveSeriesIndex', () => ({ LiveSeries: {}, LiveSession: { findByPk: jest.fn(async () => null) } }));

const fb = require('../services/classFeedbackService');
const attendance = require('../services/classAttendanceService');
const dispatch = require('../services/classFeedbackDispatchService');

const CLASS_ID = '0b6c7c5e-1111-4222-8333-944455556666';
const HOST = 7;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const users = [
  { id: 7, email: 'host@example.com', firstname: 'Ada' },
  { id: 21, email: 'p21@example.com', firstname: 'Bo' },
  { id: 22, email: 'p22@example.com', firstname: 'Cy' },
  { id: 23, email: null, firstname: 'NoMail' }
];
const deps = () => ({
  sendEmail: jest.fn(async () => undefined),
  loadUsers: jest.fn(async (ids) => users.filter((u) => ids.includes(u.id)))
});

beforeEach(() => {
  mockAttendance.clear();
  mockResponses.clear();
  mockQueries.length = 0;
  mockReady = true;
  mockDue = [];
  mockClasses.set(CLASS_ID, {
    id: CLASS_ID,
    title: 'Intro to Figma',
    status: 'ended',
    userId: HOST,
    creator: { firstname: 'Ada', lastname: 'Host' }
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('attendance', () => {
  test('records a join in the background and never downgrades a host', async () => {
    attendance.recordAttendance({ kind: 'class', targetId: CLASS_ID, userId: 21, role: 'host' });
    await flush();
    attendance.recordAttendance({ kind: 'class', targetId: CLASS_ID, userId: 21, role: 'participant' });
    await flush();
    expect(await attendance.attended('class', CLASS_ID, 21)).toBe('host');
  });

  test('ignores bad input and does nothing while tables are not ready', async () => {
    attendance.recordAttendance({ kind: 'class', targetId: 'not-a-uuid', userId: 21, role: 'participant' });
    attendance.recordAttendance({ kind: 'room', targetId: CLASS_ID, userId: 21, role: 'participant' });
    mockReady = false;
    attendance.recordAttendance({ kind: 'class', targetId: CLASS_ID, userId: 22, role: 'participant' });
    await flush();
    expect(mockQueries.filter((q) => q.sql.startsWith('INSERT INTO live_room_attendance'))).toHaveLength(0);
  });
});

describe('end-screen link', () => {
  test('gives an attendee their own participant link once the class has ended', async () => {
    mockAttendance.set(`class:${CLASS_ID}`, [{ userId: 21, role: 'participant' }]);
    const out = await fb.linkFor({ kind: 'class', targetId: CLASS_ID, userId: 21 });
    expect(out.role).toBe('participant');
    expect(out.responded).toBe(false);
    expect(out.url).toBe(`https://hallos.net/feedback/${out.token}`);
    expect(fb.readToken(out.token)).toEqual({ kind: 'class', targetId: CLASS_ID, userId: 21, role: 'participant' });
  });

  test('the creator gets the host form even without an attendance row', async () => {
    const out = await fb.linkFor({ kind: 'class', targetId: CLASS_ID, userId: HOST });
    expect(out.role).toBe('host');
  });

  test('refuses people who were not in the class', async () => {
    await expect(fb.linkFor({ kind: 'class', targetId: CLASS_ID, userId: 99 })).rejects.toMatchObject({
      status: 403,
      code: 'NOT_ATTENDED'
    });
  });

  test('refuses while the class is still live', async () => {
    mockClasses.get(CLASS_ID).status = 'live';
    mockAttendance.set(`class:${CLASS_ID}`, [{ userId: 21, role: 'participant' }]);
    await expect(fb.linkFor({ kind: 'class', targetId: CLASS_ID, userId: 21 })).rejects.toMatchObject({
      status: 409,
      code: 'NOT_ENDED'
    });
  });

  test('says when the person already answered', async () => {
    mockAttendance.set(`class:${CLASS_ID}`, [{ userId: 21, role: 'participant' }]);
    mockResponses.set(`class:${CLASS_ID}:21`, { overall: 5, answers: {} });
    const out = await fb.linkFor({ kind: 'class', targetId: CLASS_ID, userId: 21 });
    expect(out).toMatchObject({ responded: true, overall: 5 });
  });

  test('rejects malformed ids and kinds', async () => {
    await expect(fb.linkFor({ kind: 'class', targetId: '1 OR 1=1', userId: 21 })).rejects.toMatchObject({ status: 404 });
    await expect(fb.linkFor({ kind: 'video', targetId: CLASS_ID, userId: 21 })).rejects.toMatchObject({ status: 404 });
  });
});

describe('feedback emails', () => {
  beforeEach(() => {
    mockAttendance.set(`class:${CLASS_ID}`, [
      { userId: HOST, role: 'host' },
      { userId: 21, role: 'participant' },
      { userId: 22, role: 'participant' },
      { userId: 23, role: 'participant' }
    ]);
  });

  test('emails everyone who joined their own role link, skipping people who answered on the end screen', async () => {
    mockResponses.set(`class:${CLASS_ID}:22`, { overall: 4 });
    const d = deps();
    const sent = await dispatch.sendFor('class', CLASS_ID, d);

    expect(sent).toBe(2); // host + 21; 22 answered, 23 has no email
    const byEmail = Object.fromEntries(d.sendEmail.mock.calls.map(([to, , opts]) => [to, opts]));
    expect(Object.keys(byEmail).sort()).toEqual(['host@example.com', 'p21@example.com']);
    expect(byEmail['host@example.com'].role).toBe('host');
    expect(byEmail['p21@example.com']).toMatchObject({ role: 'participant', title: 'Intro to Figma', hostName: 'Ada Host' });

    const token = byEmail['p21@example.com'].url.split('/feedback/')[1];
    expect(fb.readToken(token)).toMatchObject({ userId: 21, role: 'participant' });
  });

  test('a class that is live again is postponed, not emailed', async () => {
    mockClasses.get(CLASS_ID).status = 'live';
    const d = deps();
    expect(await dispatch.sendFor('class', CLASS_ID, d)).toBe(0);
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(mockQueries.some((q) => q.sql.includes('SET claimed_at = NULL'))).toBe(true);
  });

  test('one failing email does not stop the rest', async () => {
    const d = deps();
    d.sendEmail.mockImplementation(async (to) => {
      if (to === 'host@example.com') throw Object.assign(new Error('smtp'), { code: 'ECONNECTION' });
    });
    expect(await dispatch.sendFor('class', CLASS_ID, d)).toBe(2);
  });

  test('a sweep schedules, sends what is due, and records how many went out', async () => {
    mockDue = [{ kind: 'class', targetId: CLASS_ID }];
    const d = deps();
    const out = await dispatch.sweep(d);
    expect(out.sent).toBe(3);
    expect(mockQueries.some((q) => q.sql.startsWith('INSERT INTO class_feedback_dispatch'))).toBe(true);
    const mark = mockQueries.find((q) => q.sql.startsWith('UPDATE class_feedback_dispatch SET sent_count'));
    expect(mark.r).toMatchObject({ kind: 'class', targetId: CLASS_ID, count: 3 });
  });

  test('does nothing when feedback tables are not ready', async () => {
    mockReady = false;
    const d = deps();
    expect(await dispatch.sweep(d)).toEqual({ scheduled: 0, sent: 0 });
    expect(mockQueries).toHaveLength(0);
  });

  test('never throws, even if the database is down', async () => {
    const db = require('../config/db');
    db.query.mockImplementationOnce(async () => {
      throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    });
    await expect(dispatch.sweep(deps())).resolves.toEqual({ scheduled: 0, sent: 0 });
  });
});
