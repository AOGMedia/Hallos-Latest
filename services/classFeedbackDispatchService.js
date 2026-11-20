const sequelize = require('../config/db');
const { isClassFeedbackReady } = require('../utils/ensureClassFeedback');
const classFeedbackService = require('./classFeedbackService');
const { attendeesOf } = require('./classAttendanceService');

/**
 * Emails each person who joined a live class or series session their
 * feedback link, a little after it ends — both providers, however it ended
 * (host, admin, auto-cleanup, recovery): no end path needs to call this.
 *
 * Every few minutes it:
 *  1. notices ended classes/sessions that people joined and schedules their
 *     emails DELAY_MINUTES out (time to answer on the end screen first);
 *  2. sends the ones that are due: each class/session is claimed atomically,
 *     so emails go out once even with restarts or several servers, and
 *     anyone who already answered (e.g. on the end screen) is skipped.
 *
 * Turn off with CLASS_FEEDBACK_EMAILS=false.
 */

const SWEEP_EVERY_MS = 5 * 60 * 1000;
const DELAY_MINUTES = 15;
/** Only recent classes are looked at (keeps the scan small). */
const LOOKBACK_DAYS = 3;
const MAX_PER_SWEEP = 20;
const EMAIL_BATCH = 5;

const errorCodeOf = (error) => (error && (error.code || error.responseCode || error.name)) || 'unknown error';

/** Step 1: schedule emails for newly ended classes/sessions that had attendees. */
async function scheduleEnded() {
  const replacements = { delay: DELAY_MINUTES, lookback: LOOKBACK_DAYS };
  const [classRows] = await sequelize.query(
    `INSERT INTO class_feedback_dispatch (target_kind, target_id, send_after)
     SELECT DISTINCT 'class', a.target_id, NOW() + (:delay || ' minutes')::interval
     FROM live_room_attendance a
     JOIN live_classes c ON c.id = a.target_id
     WHERE a.target_kind = 'class'
       AND c.status IN ('ended', 'recorded')
       AND a.last_joined_at > NOW() - (:lookback || ' days')::interval
     ON CONFLICT (target_kind, target_id) DO NOTHING
     RETURNING target_id`,
    { replacements }
  );
  const [sessionRows] = await sequelize.query(
    `INSERT INTO class_feedback_dispatch (target_kind, target_id, send_after)
     SELECT DISTINCT 'session', a.target_id, NOW() + (:delay || ' minutes')::interval
     FROM live_room_attendance a
     JOIN live_sessions s ON s.id = a.target_id
     WHERE a.target_kind = 'session'
       AND s.status = 'ended'
       AND a.last_joined_at > NOW() - (:lookback || ' days')::interval
     ON CONFLICT (target_kind, target_id) DO NOTHING
     RETURNING target_id`,
    { replacements }
  );
  return classRows.length + sessionRows.length;
}

/** Claim due dispatches; only the claimer sends them. */
async function claimDue() {
  const [rows] = await sequelize.query(
    `UPDATE class_feedback_dispatch d SET claimed_at = NOW()
     FROM (
       SELECT target_kind, target_id FROM class_feedback_dispatch
       WHERE claimed_at IS NULL AND send_after <= NOW()
       ORDER BY send_after
       LIMIT :limit
       FOR UPDATE SKIP LOCKED
     ) due
     WHERE d.target_kind = due.target_kind AND d.target_id = due.target_id
     RETURNING d.target_kind AS kind, d.target_id AS "targetId"`,
    { replacements: { limit: MAX_PER_SWEEP } }
  );
  return rows;
}

/** It came back to life (restarted): try again later instead of sending now. */
const postpone = (kind, targetId) =>
  sequelize.query(
    `UPDATE class_feedback_dispatch SET claimed_at = NULL, send_after = NOW() + (:delay || ' minutes')::interval
     WHERE target_kind = :kind AND target_id = :targetId`,
    { replacements: { kind, targetId, delay: DELAY_MINUTES } }
  );

const markSent = (kind, targetId, count) =>
  sequelize.query(
    'UPDATE class_feedback_dispatch SET sent_count = :count WHERE target_kind = :kind AND target_id = :targetId',
    { replacements: { kind, targetId, count } }
  );

/** People who already answered for this class/session. */
async function respondedUserIds(kind, targetId) {
  const [rows] = await sequelize.query(
    'SELECT user_id AS "userId" FROM class_feedback WHERE target_kind = :kind AND target_id = :targetId',
    { replacements: { kind, targetId } }
  );
  return new Set(rows.map((r) => Number(r.userId)));
}

/** Email everyone who joined (and hasn't answered yet) their own link. Returns how many were sent. */
async function sendFor(kind, targetId, { sendEmail, loadUsers }) {
  const target = await classFeedbackService.describeTarget(kind, targetId);
  if (!target) return 0;
  if (!target.ended) {
    await postpone(kind, targetId);
    return 0;
  }

  const [attendees, responded] = await Promise.all([attendeesOf(kind, targetId), respondedUserIds(kind, targetId)]);
  const pending = attendees.filter((a) => !responded.has(Number(a.userId)));
  if (!pending.length) return 0;

  const users = await loadUsers(pending.map((a) => Number(a.userId)));
  const byId = new Map(users.map((u) => [Number(u.id), u]));

  let sent = 0;
  for (let i = 0; i < pending.length; i += EMAIL_BATCH) {
    const batch = pending.slice(i, i + EMAIL_BATCH);
    const results = await Promise.allSettled(
      batch.map(async (a) => {
        const user = byId.get(Number(a.userId));
        if (!user || !user.email) return false;
        const token = classFeedbackService.createToken({ kind, targetId, userId: Number(a.userId), role: a.role });
        await sendEmail(user.email, user.firstname, {
          title: target.title,
          sessionLabel: target.sessionLabel,
          hostName: target.hostName,
          role: a.role,
          url: classFeedbackService.feedbackUrl(token)
        });
        return true;
      })
    );
    results.forEach((r, j) => {
      if (r.status === 'fulfilled' && r.value) sent += 1;
      else if (r.status === 'rejected') {
        console.error(`[Class feedback] Email to user ${batch[j].userId} failed (${errorCodeOf(r.reason)})`);
      }
    });
  }
  return sent;
}

const defaultDeps = () => ({
  sendEmail: (...args) => require('../utils/email').sendClassFeedbackEmail(...args),
  loadUsers: async (ids) => {
    const User = require('../models/User');
    const { Op } = require('sequelize');
    return User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'email', 'firstname'] });
  }
});

let running = false;

/** One sweep: schedule what newly ended, send what's due. Never throws. */
async function sweep(deps = defaultDeps()) {
  if (running || !isClassFeedbackReady()) return { scheduled: 0, sent: 0 };
  running = true;
  let scheduled = 0;
  let sent = 0;
  try {
    scheduled = await scheduleEnded();
    for (const { kind, targetId } of await claimDue()) {
      try {
        const count = await sendFor(kind, targetId, deps);
        await markSent(kind, targetId, count);
        sent += count;
      } catch (error) {
        // Claimed: it won't retry and spam people; log and move on.
        console.error(`[Class feedback] Sending for ${kind} ${targetId} failed (${errorCodeOf(error)})`);
      }
    }
    if (scheduled || sent) console.log(`[Class feedback] Scheduled ${scheduled}, emailed ${sent}`);
  } catch (error) {
    console.error(`[Class feedback] Sweep failed (${errorCodeOf(error)})`);
  } finally {
    running = false;
  }
  return { scheduled, sent };
}

let timer = null;

/** Start sweeping (once). */
function start() {
  if (timer || process.env.CLASS_FEEDBACK_EMAILS === 'false') return;
  timer = setInterval(() => void sweep(), SWEEP_EVERY_MS);
  if (typeof timer.unref === 'function') timer.unref();
  // A first pass shortly after boot.
  setTimeout(() => void sweep(), 60 * 1000).unref?.();
  console.log('✅ Class feedback emails: sweeping every 5 minutes');
}

module.exports = { start, sweep, scheduleEnded, claimDue, sendFor, DELAY_MINUTES };
