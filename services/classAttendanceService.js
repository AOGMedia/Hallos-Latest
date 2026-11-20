const sequelize = require('../config/db');
const { isClassFeedbackReady } = require('../utils/ensureClassFeedback');

/**
 * Who actually got into a live class or series session room — for GetStream
 * and ZegoCloud alike (ZegoCloud keeps no attendance of its own). Recorded
 * when our backend lets someone in; used to send feedback to the people who
 * were there.
 *
 * Recording never blocks or fails a join: it runs after the response and
 * swallows its own errors.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Note that someone joined (hosts: creator or co-host). Fire-and-forget.
 * A later join as host upgrades a participant row; never the other way.
 */
function recordAttendance({ kind, targetId, userId, role }) {
  if (!isClassFeedbackReady()) return;
  if (!['class', 'session'].includes(kind) || !['host', 'participant'].includes(role)) return;
  if (!UUID.test(String(targetId)) || !Number.isInteger(Number(userId))) return;
  setImmediate(() => {
    sequelize
      .query(
        `INSERT INTO live_room_attendance (target_kind, target_id, user_id, role, first_joined_at, last_joined_at)
         VALUES (:kind, :targetId, :userId, :role, NOW(), NOW())
         ON CONFLICT (target_kind, target_id, user_id) DO UPDATE SET
           last_joined_at = NOW(),
           role = CASE WHEN EXCLUDED.role = 'host' THEN 'host' ELSE live_room_attendance.role END`,
        { replacements: { kind, targetId: String(targetId), userId: Number(userId), role } }
      )
      .catch((error) => console.error('[Attendance] Could not record a join:', error.message));
  });
}

/** Everyone who joined, with their role. */
async function attendeesOf(kind, targetId) {
  const [rows] = await sequelize.query(
    `SELECT user_id AS "userId", role FROM live_room_attendance WHERE target_kind = :kind AND target_id = :targetId`,
    { replacements: { kind, targetId } }
  );
  return rows;
}

/** Whether this person got into this class/session. */
async function attended(kind, targetId, userId) {
  if (!isClassFeedbackReady()) return null;
  const [rows] = await sequelize.query(
    `SELECT role FROM live_room_attendance WHERE target_kind = :kind AND target_id = :targetId AND user_id = :userId`,
    { replacements: { kind, targetId, userId } }
  );
  return rows[0] ? rows[0].role : null;
}

module.exports = { recordAttendance, attendeesOf, attended };
