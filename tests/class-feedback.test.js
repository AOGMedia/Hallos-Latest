/**
 * Feedback after live classes and series sessions: personal links, the
 * after-class-only rule, answer validation per role, and one response per
 * person (updated, never duplicated). Database and models are mocked.
 */
process.env.JWT_SECRET_KEY = 'test-secret';
process.env.CLIENT_URL = 'https://hallos.net';

const mockRows = new Map();
let mockReady = true;
const mockClasses = new Map();
const mockSessions = new Map();

jest.mock('../config/db', () => ({
  query: jest.fn(async (sql, { replacements: r } = {}) => {
    const key = (x) => `${x.kind}:${x.targetId}:${x.userId}`;
    if (/^SELECT overall/.test(sql.trim())) {
      const row = mockRows.get(key(r));
      return [row ? [row] : []];
    }
    if (/^INSERT INTO class_feedback/.test(sql.trim())) {
      const prev = mockRows.get(key(r));
      const answers = JSON.parse(r.answers);
      mockRows.set(key(r), {
        overall: r.overall,
        answers: { ...(prev ? prev.answers : {}), ...answers },
        comment: r.comment || (prev ? prev.comment : null),
        anonymous: r.anonymous,
        role: r.role
      });
      return [[]];
    }
    return [[]];
  })
}));
jest.mock('../utils/ensureClassFeedback', () => ({ isClassFeedbackReady: () => mockReady }));
jest.mock('../models/User', () => ({}));
jest.mock('../models/liveIndex', () => ({
  LiveClass: { findByPk: jest.fn(async (id) => mockClasses.get(id) || null) }
}));
jest.mock('../models/liveSeriesIndex', () => ({
  LiveSeries: {},
  LiveSession: { findByPk: jest.fn(async (id) => mockSessions.get(id) || null) }
}));

const fb = require('../services/classFeedbackService');

const CLASS_ID = '0b6c7c5e-1111-4222-8333-944455556666';
const SESSION_ID = '1b6c7c5e-1111-4222-8333-944455556666';
const creator = { firstname: 'Ada', lastname: 'Creator' };

beforeEach(() => {
  mockRows.clear();
  mockReady = true;
  mockClasses.set(CLASS_ID, { id: CLASS_ID, title: 'Intro to Figma', status: 'ended', userId: 7, creator });
  mockSessions.set(SESSION_ID, {
    id: SESSION_ID,
    sessionNumber: 3,
    status: 'ended',
    series: { title: 'Design Series', userId: 7, creator }
  });
});

const participantToken = (overrides = {}) =>
  fb.createToken({ kind: 'class', targetId: CLASS_ID, userId: 42, role: 'participant', ...overrides });

describe('personal links', () => {
  test('a link carries who and what, and its URL is on the website', () => {
    const token = participantToken();
    expect(fb.readToken(token)).toEqual({ kind: 'class', targetId: CLASS_ID, userId: 42, role: 'participant' });
    expect(fb.feedbackUrl(token)).toBe(`https://hallos.net/feedback/${token}`);
  });

  test('a tampered link is refused (cannot become someone else or a host)', () => {
    const token = participantToken();
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), u: 1, r: 'host' })
    ).toString('base64url');
    expect(() => fb.readToken(`${forged}.${sig}`)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => fb.readToken('junk')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => fb.readToken(`${payload}.${'x'.repeat(sig.length)}`)).toThrow(expect.objectContaining({ status: 404 }));
  });

  test('links expire after 30 days', () => {
    const token = fb.createToken({ kind: 'class', targetId: CLASS_ID, userId: 42, role: 'participant' }, Date.now() - 31 * 86400000);
    expect(() => fb.readToken(token)).toThrow(expect.objectContaining({ status: 410 }));
  });

  test('a link for a non-UUID id is refused before reaching the database', () => {
    const token = fb.createToken({ kind: 'class', targetId: '1; DROP TABLE', userId: 42, role: 'participant' });
    expect(() => fb.readToken(token)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('the form', () => {
  test('shows the class, host and role once the class has ended', async () => {
    const form = await fb.getForm(participantToken());
    expect(form).toEqual({
      kind: 'class',
      role: 'participant',
      title: 'Intro to Figma',
      sessionLabel: null,
      hostName: 'Ada Creator',
      response: null
    });
  });

  test('series sessions show the series and session number', async () => {
    const form = await fb.getForm(fb.createToken({ kind: 'session', targetId: SESSION_ID, userId: 7, role: 'host' }));
    expect(form).toMatchObject({ title: 'Design Series', sessionLabel: 'Session 3', role: 'host' });
  });

  test('closed while the class is still running (feedback is after class only)', async () => {
    mockClasses.get(CLASS_ID).status = 'live';
    await expect(fb.getForm(participantToken())).rejects.toMatchObject({ status: 409, code: 'NOT_ENDED' });
    await expect(fb.submit(participantToken(), { overall: 5 })).rejects.toMatchObject({ status: 409 });
  });

  test('a recorded class counts as ended', async () => {
    mockClasses.get(CLASS_ID).status = 'recorded';
    await expect(fb.getForm(participantToken())).resolves.toMatchObject({ title: 'Intro to Figma' });
  });

  test('table not ready: a clear "try later"', async () => {
    mockReady = false;
    await expect(fb.getForm(participantToken())).rejects.toMatchObject({ status: 503 });
  });
});

describe('answers', () => {
  test('one tap (the overall rating) is enough, and the rest can follow', async () => {
    const token = participantToken();
    await fb.submit(token, { overall: 4 });
    expect((await fb.getForm(token)).response).toMatchObject({ overall: 4, answers: {} });

    await fb.submit(token, { overall: 4, answers: { host: 5, useful: 'very', issues: ['audio', 'audio'] }, comment: '  Loved it  ' });
    const after = (await fb.getForm(token)).response;
    expect(after).toMatchObject({ overall: 4, answers: { host: 5, useful: 'very', issues: ['audio'] }, comment: 'Loved it' });
    expect(mockRows.size).toBe(1); // updated, not duplicated
    expect(await fb.hasResponded('class', CLASS_ID, 42)).toBe(true);
    expect(await fb.hasResponded('class', CLASS_ID, 43)).toBe(false);
  });

  test.each([
    [{}],
    [{ overall: 0 }],
    [{ overall: 6 }],
    [{ overall: 3.5 }],
    [{ overall: 5, answers: { host: 9 } }],
    [{ overall: 5, answers: { useful: 'meh' } }],
    [{ overall: 5, answers: { issues: ['hacked'] } }],
    [{ overall: 5, answers: { issues: 'audio' } }]
  ])('refuses %j', async (body) => {
    await expect(fb.submit(participantToken(), body)).rejects.toMatchObject({ status: 400 });
  });

  test('what should improve: each role has its own options; "nothing" never sits with suggestions', () => {
    expect(fb.cleanAnswers('participant', { improve: ['pace', 'examples'] })).toEqual({ improve: ['pace', 'examples'] });
    expect(fb.cleanAnswers('participant', { improve: ['nothing'] })).toEqual({ improve: ['nothing'] });
    expect(fb.cleanAnswers('participant', { improve: ['nothing', 'pace'] })).toEqual({ improve: ['pace'] });
    expect(fb.cleanAnswers('host', { improve: ['tools', 'reach'] })).toEqual({ improve: ['tools', 'reach'] });
    expect(() => fb.cleanAnswers('participant', { improve: ['payments'] })).toThrow(); // a host option
    expect(() => fb.cleanAnswers('host', { improve: ['pace'] })).toThrow(); // a participant option
  });

  test('each role only keeps its own questions', () => {
    expect(fb.cleanAnswers('host', { engagement: 'high', host: 5, useful: 'very' })).toEqual({ engagement: 'high' });
    expect(() => fb.cleanAnswers('host', { issues: ['recording'] })).not.toThrow();
    expect(() => fb.cleanAnswers('participant', { issues: ['recording'] })).toThrow();
  });

  test('participants can be anonymous; hosts cannot', async () => {
    await fb.submit(participantToken(), { overall: 3, anonymous: true });
    expect(mockRows.get(`class:${CLASS_ID}:42`).anonymous).toBe(true);
    await fb.submit(fb.createToken({ kind: 'class', targetId: CLASS_ID, userId: 7, role: 'host' }), { overall: 5, anonymous: true });
    expect(mockRows.get(`class:${CLASS_ID}:7`).anonymous).toBe(false);
  });

  test('long comments are trimmed to 2000 characters', async () => {
    await fb.submit(participantToken(), { overall: 5, comment: 'a'.repeat(5000) });
    expect(mockRows.get(`class:${CLASS_ID}:42`).comment.length).toBe(2000);
  });
});
