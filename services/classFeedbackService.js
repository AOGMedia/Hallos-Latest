const crypto = require('crypto');
const sequelize = require('../config/db');
const { isClassFeedbackReady } = require('../utils/ensureClassFeedback');

/**
 * Feedback after a live class or a series session, from the people who were
 * in it: participants and hosts get different questions. Works the same for
 * GetStream and ZegoCloud (it only needs the class/session and the person).
 *
 * Access is by a personal link: a signed token naming the class/session, the
 * person and their role. No account step is needed to answer, nobody can
 * answer as someone else, and each person has one response per class (they
 * can change it). Feedback only opens once the class has ended.
 */

class FeedbackError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'FeedbackError';
    this.status = status;
    this.code = code;
  }
}

const TOKEN_TTL_DAYS = 30;
const KINDS = ['class', 'session'];
const ROLES = ['participant', 'host'];
const MAX_COMMENT = 2000;
/** Classes and series sessions both have UUID ids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The questions each role can answer (besides the overall rating and comment). Values are checked against these. */
const ANSWER_SCHEMA = {
  participant: {
    host: { type: 'rating' },
    useful: { type: 'one', values: ['not_really', 'somewhat', 'very'] },
    quality: { type: 'one', values: ['great', 'some_issues', 'poor'] },
    issues: { type: 'many', values: ['audio', 'video', 'lag', 'screen_share', 'other'] },
    again: { type: 'one', values: ['yes', 'maybe', 'no'] },
    // What should be better next time.
    improve: {
      type: 'many',
      values: ['pace', 'clarity', 'interaction', 'examples', 'materials', 'audio_video', 'timing', 'nothing']
    }
  },
  host: {
    engagement: { type: 'one', values: ['low', 'ok', 'high'] },
    issues: { type: 'many', values: ['audio', 'video', 'lag', 'screen_share', 'recording', 'other'] },
    smooth: { type: 'one', values: ['yes', 'mostly', 'no'] },
    // What would make their next class better on Hallos.
    improve: {
      type: 'many',
      values: ['tools', 'engagement', 'stability', 'recording', 'reach', 'payments', 'nothing']
    }
  }
};

/** In "what should improve", "nothing" can't sit alongside real suggestions. */
const EXCLUSIVE = 'nothing';

// ── Personal links ────────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET_KEY || '').update(`class-feedback:${payload}`).digest('base64url');

/** A personal feedback token for one person and one class/session. */
function createToken({ kind, targetId, userId, role }, now = Date.now()) {
  if (!KINDS.includes(kind) || !ROLES.includes(role)) throw new Error('Invalid feedback token details');
  const payload = b64url(
    JSON.stringify({ v: 1, k: kind, t: String(targetId), u: Number(userId), r: role, e: Math.floor(now / 1000) + TOKEN_TTL_DAYS * 86400 })
  );
  return `${payload}.${sign(payload)}`;
}

/** The details in a token, or a FeedbackError if it's not genuine or has expired. */
function readToken(token, now = Date.now()) {
  const invalid = new FeedbackError('This feedback link isn’t valid.', 404, 'INVALID_LINK');
  if (typeof token !== 'string' || token.length > 600) throw invalid;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw invalid;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw invalid;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  if (data.v !== 1 || !KINDS.includes(data.k) || !ROLES.includes(data.r) || !Number.isInteger(data.u) || !UUID.test(String(data.t))) {
    throw invalid;
  }
  if (data.e * 1000 < now) throw new FeedbackError('This feedback link has expired.', 410, 'LINK_EXPIRED');
  return { kind: data.k, targetId: data.t, userId: data.u, role: data.r };
}

/** The link people open (website). */
function feedbackUrl(token) {
  const base = String(process.env.CLIENT_URL || 'https://hallos.net').replace(/\/+$/, '');
  return `${base}/feedback/${token}`;
}

// ── The class or session being reviewed ─────────────────────────────────────

const fullName = (user) => (user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() : '') || 'your host';

/** Title, host and whether it has ended, for a class or a series session. */
async function describeTarget(kind, targetId) {
  if (kind === 'class') {
    const { LiveClass } = require('../models/liveIndex');
    const User = require('../models/User');
    const liveClass = await LiveClass.findByPk(targetId, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstname', 'lastname'] }]
    });
    if (!liveClass) return null;
    return {
      title: liveClass.title,
      sessionLabel: null,
      hostName: fullName(liveClass.creator),
      hostId: liveClass.userId,
      ended: ['ended', 'recorded'].includes(liveClass.status)
    };
  }
  const { LiveSession, LiveSeries } = require('../models/liveSeriesIndex');
  const User = require('../models/User');
  const session = await LiveSession.findByPk(targetId, {
    include: [{ model: LiveSeries, as: 'series', include: [{ model: User, as: 'creator', attributes: ['id', 'firstname', 'lastname'] }] }]
  });
  if (!session || !session.series) return null;
  return {
    title: session.series.title,
    sessionLabel: `Session ${session.sessionNumber}`,
    hostName: fullName(session.series.creator),
    hostId: session.series.userId,
    ended: session.status === 'ended'
  };
}

// ── Answers ─────────────────────────────────────────────────────────────────

const isRating = (n) => Number.isInteger(n) && n >= 1 && n <= 5;

/** Clean, validated answers for a role. Unknown questions are dropped; bad values refused. */
function cleanAnswers(role, input) {
  const schema = ANSWER_SCHEMA[role];
  const answers = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return answers;
  for (const [key, rule] of Object.entries(schema)) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (rule.type === 'rating') {
      if (!isRating(value)) throw new FeedbackError('Ratings go from 1 to 5.');
      answers[key] = value;
    } else if (rule.type === 'one') {
      if (!rule.values.includes(value)) throw new FeedbackError('That answer isn’t one of the options.');
      answers[key] = value;
    } else if (rule.type === 'many') {
      if (!Array.isArray(value) || value.some((v) => !rule.values.includes(v))) {
        throw new FeedbackError('That answer isn’t one of the options.');
      }
      const unique = [...new Set(value)];
      // "Nothing" plus real suggestions: keep the suggestions.
      answers[key] = unique.length > 1 ? unique.filter((v) => v !== EXCLUSIVE) : unique;
    }
  }
  return answers;
}

const requireReady = () => {
  if (!isClassFeedbackReady()) throw new FeedbackError('Feedback can’t be taken right now. Please try again shortly.', 503);
};

async function findResponse({ kind, targetId, userId }) {
  const [rows] = await sequelize.query(
    `SELECT overall, answers, comment, anonymous, updated_at FROM class_feedback
     WHERE target_kind = :kind AND target_id = :targetId AND user_id = :userId`,
    { replacements: { kind, targetId, userId } }
  );
  return rows[0] || null;
}

/** Whether this person has already given feedback for this class/session. */
async function hasResponded(kind, targetId, userId) {
  if (!isClassFeedbackReady()) return false;
  return Boolean(await findResponse({ kind, targetId, userId }));
}

/** What the form needs: the class, the person's role, and their answers so far. */
async function getForm(token) {
  const link = readToken(token);
  requireReady();
  const target = await describeTarget(link.kind, link.targetId);
  if (!target) throw new FeedbackError('We couldn’t find this class.', 404, 'NOT_FOUND');
  if (!target.ended) throw new FeedbackError('Feedback opens when the class has ended.', 409, 'NOT_ENDED');

  const existing = await findResponse(link);
  return {
    kind: link.kind,
    role: link.role,
    title: target.title,
    sessionLabel: target.sessionLabel,
    hostName: target.hostName,
    response: existing
      ? { overall: existing.overall, answers: existing.answers || {}, comment: existing.comment || '', anonymous: existing.anonymous }
      : null
  };
}

/**
 * Save (or update) the person's feedback. The overall rating is the one
 * required answer, so a single tap counts; everything else can follow.
 */
async function submit(token, body) {
  const link = readToken(token);
  requireReady();
  const target = await describeTarget(link.kind, link.targetId);
  if (!target) throw new FeedbackError('We couldn’t find this class.', 404, 'NOT_FOUND');
  if (!target.ended) throw new FeedbackError('Feedback opens when the class has ended.', 409, 'NOT_ENDED');

  const input = body && typeof body === 'object' ? body : {};
  const overall = Number(input.overall);
  if (!isRating(overall)) throw new FeedbackError('Please choose a rating from 1 to 5.');
  const answers = cleanAnswers(link.role, input.answers);
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, MAX_COMMENT) : '';
  // Hosts' notes are for Hallos; only participants can stay anonymous to the host.
  const anonymous = link.role === 'participant' && input.anonymous === true;

  await sequelize.query(
    `INSERT INTO class_feedback (target_kind, target_id, user_id, role, overall, answers, comment, anonymous, created_at, updated_at)
     VALUES (:kind, :targetId, :userId, :role, :overall, CAST(:answers AS JSONB), :comment, :anonymous, NOW(), NOW())
     ON CONFLICT (target_kind, target_id, user_id) DO UPDATE SET
       overall = EXCLUDED.overall,
       answers = class_feedback.answers || EXCLUDED.answers,
       comment = COALESCE(NULLIF(EXCLUDED.comment, ''), class_feedback.comment),
       anonymous = EXCLUDED.anonymous,
       updated_at = NOW()`,
    {
      replacements: {
        kind: link.kind,
        targetId: link.targetId,
        userId: link.userId,
        role: link.role,
        overall,
        answers: JSON.stringify(answers),
        comment: comment || null,
        anonymous
      }
    }
  );
  return { saved: true };
}

/**
 * The signed-in person's own feedback link, for the class-ended screen in the
 * room. Only once it has ended, and only for people who were in it (or made it).
 */
async function linkFor({ kind, targetId, userId }) {
  if (!KINDS.includes(kind) || !UUID.test(String(targetId)) || !Number.isInteger(Number(userId))) {
    throw new FeedbackError('We couldn’t find this class.', 404, 'NOT_FOUND');
  }
  requireReady();
  const target = await describeTarget(kind, targetId);
  if (!target) throw new FeedbackError('We couldn’t find this class.', 404, 'NOT_FOUND');
  if (!target.ended) throw new FeedbackError('Feedback opens when the class has ended.', 409, 'NOT_ENDED');

  const { attended } = require('./classAttendanceService');
  const joinedAs = await attended(kind, targetId, Number(userId));
  const role = Number(target.hostId) === Number(userId) ? 'host' : joinedAs;
  if (!role) throw new FeedbackError('Feedback is for people who were in this class.', 403, 'NOT_ATTENDED');

  const token = createToken({ kind, targetId, userId: Number(userId), role });
  const existing = await findResponse({ kind, targetId, userId: Number(userId) });
  return { token, url: feedbackUrl(token), role, responded: Boolean(existing), overall: existing ? existing.overall : null };
}

module.exports = {
  FeedbackError,
  ANSWER_SCHEMA,
  createToken,
  readToken,
  feedbackUrl,
  describeTarget,
  cleanAnswers,
  hasResponded,
  getForm,
  submit,
  linkFor
};
