/**
 * Class feedback, stage 3: reading it back. The admin sees everything
 * (including who sent anonymous answers); a creator sees only their own
 * classes, only participants' answers, anonymous ones without a name, and
 * nobody's email. Database and models are mocked.
 */
const CLASS_ID = '0b6c7c5e-1111-4222-8333-944455556666';
const OWNER = 7;

const mockResponses = [];
const mockAttendance = [];
let mockInfo = null;
let mockDispatch = null;
const mockQueries = [];

jest.mock('../config/db', () => ({
  query: jest.fn(async (sql, { replacements: r = {} } = {}) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    mockQueries.push({ sql: s, r });
    if (s.includes('FROM live_classes c WHERE c.id = :id')) return mockInfo ? [mockInfo] : [];
    if (s.startsWith('SELECT id, user_id AS "userId", role, overall')) return mockResponses;
    if (s.startsWith('SELECT user_id AS "userId", role, first_joined_at')) return mockAttendance;
    if (s.startsWith('SELECT sent_count')) return mockDispatch ? [mockDispatch] : [];
    return [];
  }),
}));
jest.mock('../utils/ensureClassFeedback', () => ({ isClassFeedbackReady: () => true }));
jest.mock('../utils/userAvatar', () => ({ avatarUrlOf: () => null }));
jest.mock('../models/User', () => ({
  findAll: jest.fn(async ({ where: { id } }) =>
    id.map((n) => ({ id: n, firstname: `First${n}`, lastname: `Last${n}`, email: `u${n}@example.com`, socialLinks: null }))
  ),
}));
jest.mock('../models/liveIndex', () => ({ LiveClass: {} }));
jest.mock('../models/liveSeriesIndex', () => ({ LiveSeries: {}, LiveSession: {} }));

const results = require('../services/classFeedbackResultsService');
const { ADMIN_ROUTE_PERMISSIONS } = require('../config/staffRouteAccess');
const { ALL_PERMISSIONS } = require('../config/staffPermissions');

const response = (userId, extra = {}) => ({
  id: `r${userId}`,
  userId,
  role: 'participant',
  overall: 4,
  answers: {},
  comment: '',
  anonymous: false,
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:00:00Z',
  ...extra,
});

beforeEach(() => {
  mockResponses.length = 0;
  mockAttendance.length = 0;
  mockQueries.length = 0;
  mockDispatch = null;
  mockInfo = {
    id: CLASS_ID,
    title: 'Intro to Figma',
    seriesId: null,
    sessionNumber: null,
    hostId: OWNER,
    provider: 'getstream',
    status: 'ended',
    privacy: 'public',
    startedAt: '2026-11-20T09:00:00Z',
    endedAt: '2026-11-20T10:00:00Z',
  };
});

describe('summaries', () => {
  test('rating averages, distributions, single and multiple choice counts, per role', () => {
    const s = results.summarize([
      { role: 'participant', overall: 5, answers: { host: 5, useful: 'very', issues: ['audio', 'lag'], improve: ['pace'] }, comment: 'Great' },
      { role: 'participant', overall: 3, answers: { host: 4, useful: 'somewhat', issues: ['audio'] }, anonymous: true },
      { role: 'host', overall: 4, answers: { smooth: 'mostly', improve: ['tools'] }, hasComment: true },
    ]);
    expect(s.participant.responses).toBe(2);
    expect(s.participant.overall).toMatchObject({ average: 4, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 } });
    expect(s.participant.answers.host.average).toBe(4.5);
    expect(s.participant.answers.useful.counts).toEqual({ not_really: 0, somewhat: 1, very: 1 });
    expect(s.participant.answers.issues).toMatchObject({ answered: 2, counts: { audio: 2, lag: 1, video: 0 } });
    expect(s.participant.answers.improve.counts.pace).toBe(1);
    expect(s.participant.comments).toBe(1);
    expect(s.participant.anonymous).toBe(1);
    expect(s.host).toMatchObject({ responses: 1, comments: 1 });
    expect(s.host.answers.smooth.counts.mostly).toBe(1);
  });

  test('empty is safe (no averages, zero counts)', () => {
    const s = results.summarize([]);
    expect(s.participant.overall.average).toBeNull();
    expect(s.host.responses).toBe(0);
  });
});

describe('list filters', () => {
  test('values are bound, never pasted into SQL; unknown values are ignored', () => {
    const f = results.targetFilters({ search: "x'; DROP TABLE users;--", kind: 'video', provider: 'evil', rating: 'low', days: 30 });
    expect(f.sql).not.toContain('DROP');
    expect(f.values.search).toContain('DROP');
    expect(f.sql).toContain('info.avg_overall < 3');
    expect(f.values).toMatchObject({ days: 30 });
    expect(f.values.kind).toBeUndefined();
    expect(f.values.provider).toBeUndefined();
  });

  test('a creator filter with an unusable id matches nothing, never everything', () => {
    expect(results.targetFilters({ hostId: 'abc' }).sql).toContain('FALSE');
    expect(results.targetFilters({ hostId: OWNER })).toMatchObject({ values: { hostId: OWNER } });
  });

  test('an admin list ignores a hostId in the query string', async () => {
    await results.listTargets({ hostId: '999', search: 'figma' });
    const listQuery = mockQueries.find((q) => q.sql.includes('WITH att AS'));
    expect(listQuery.r.hostId).toBeUndefined();
    expect(listQuery.r.search).toBe('%figma%');
  });

  test('a creator list is always limited to their own classes', async () => {
    await results.creatorTargets(OWNER, { hostId: '999' });
    const listQuery = mockQueries.find((q) => q.sql.includes('WITH att AS'));
    expect(listQuery.r.hostId).toBe(OWNER);
    expect(listQuery.sql).toContain('info.host_id = :hostId');
    expect(listQuery.sql).toContain(`info.status IN ('ended', 'recorded')`);
  });
});

describe('admin: one class', () => {
  test('everything, including who sent anonymous answers, and who has not answered', async () => {
    mockAttendance.push(
      { userId: OWNER, role: 'host', joinedAt: '2026-11-20T09:00:00Z' },
      { userId: 21, role: 'participant', joinedAt: '2026-11-20T09:01:00Z' },
      { userId: 22, role: 'participant', joinedAt: '2026-11-20T09:02:00Z' },
      { userId: 23, role: 'participant', joinedAt: '2026-11-20T09:03:00Z' }
    );
    mockResponses.push(
      response(21, { anonymous: true, comment: 'Too fast' }),
      response(22, { overall: 2 }),
      response(OWNER, { role: 'host', overall: 5, comment: 'Recording failed once' })
    );
    mockDispatch = { sent_count: 2, claimed_at: '2026-11-20T10:15:00Z', send_after: '2026-11-20T10:15:00Z' };

    const out = await results.adminTarget('class', CLASS_ID);
    expect(out.host.email).toBe('u7@example.com');
    expect(out.joined).toEqual({ participants: 3, hosts: 1 });
    expect(out.responded).toEqual({ participants: 2, hosts: 1 });
    expect(out.responseRate).toBe(0.67);
    expect(out.emails).toMatchObject({ status: 'sent', sentCount: 2 });
    const anon = out.responses.find((r) => r.id === 'r21');
    expect(anon).toMatchObject({ anonymous: true, comment: 'Too fast', person: { email: 'u21@example.com' } });
    expect(out.responses.find((r) => r.role === 'host').comment).toBe('Recording failed once');
    expect(out.waiting.map((w) => w.person.id)).toEqual([23]);
    expect(out.summary.participant.overall.average).toBe(3);
  });

  test('bad ids are not found, without touching the database', async () => {
    expect(await results.adminTarget('class', 'nope')).toBeNull();
    expect(await results.adminTarget('room', CLASS_ID)).toBeNull();
    expect(mockQueries).toHaveLength(0);
  });
});

describe('creator: one class', () => {
  beforeEach(() => {
    mockAttendance.push({ userId: 21, role: 'participant' }, { userId: 22, role: 'participant' }, { userId: 30, role: 'host' });
    mockResponses.push(
      response(21, { anonymous: true, comment: 'Too fast' }),
      response(22, { overall: 5, comment: 'Loved it' }),
      response(30, { role: 'host', overall: 2, comment: 'Co-host note to Hallos' })
    );
  });

  test('participants only; anonymous answers have no name; nobody’s email', async () => {
    const out = await results.creatorTarget(OWNER, 'class', CLASS_ID);
    expect(out.responses).toBe(2);
    expect(out.responseRate).toBe(1);
    expect(out.feedback.map((f) => f.comment)).not.toContain('Co-host note to Hallos');
    const anon = out.feedback.find((f) => f.anonymous);
    expect(anon.person).toBeNull();
    const named = out.feedback.find((f) => !f.anonymous);
    expect(named.person).toEqual({ firstname: 'First22', lastname: 'Last22', avatarUrl: null });
    expect(JSON.stringify(out)).not.toContain('@example.com');
    expect(JSON.stringify(out)).not.toMatch(/"userId"/);
    expect(out.summary.responses).toBe(2);
  });

  test('anonymous people are never even looked up', async () => {
    const User = require('../models/User');
    User.findAll.mockClear();
    await results.creatorTarget(OWNER, 'class', CLASS_ID);
    expect(User.findAll.mock.calls[0][0].where.id).toEqual([22]);
  });

  test('someone else’s class is not found (no hint it exists)', async () => {
    await expect(results.creatorTarget(99, 'class', CLASS_ID)).rejects.toMatchObject({ status: 404 });
  });
});

describe('staff access', () => {
  const ruleFor = (method, path) => ADMIN_ROUTE_PERMISSIONS.find(([m, re]) => m === method && re.test(path))?.[2];

  test('class feedback needs its own permission, which exists', () => {
    expect(ALL_PERMISSIONS).toContain('feedback.classes');
    expect(ruleFor('GET', '/class-feedback/overview')).toBe('feedback.classes');
    expect(ruleFor('GET', '/class-feedback/targets')).toBe('feedback.classes');
    expect(ruleFor('GET', `/class-feedback/targets/class/${CLASS_ID}`)).toBe('feedback.classes');
    expect(ruleFor('GET', `/class-feedback/targets/room/${CLASS_ID}`)).toBeUndefined();
  });
});
