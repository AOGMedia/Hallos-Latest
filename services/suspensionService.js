const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Suspended accounts. Checked on every authenticated request, so the check is
 * an in-memory lookup of the (small) set of open suspensions.
 *
 * No timers or background jobs: the set is loaded on boot, updated at once when
 * staff suspend or lift someone here, and otherwise reloaded at most every 30
 * seconds, triggered by traffic and never awaited by the request (this keeps
 * other server instances in step).
 *
 * Fails open: if the set can't be loaded, nobody is treated as suspended.
 */
const MAX_AGE_MS = 30 * 1000;

/** userId -> end time in ms, or Infinity until lifted. */
let suspended = new Map();
let loadedAt = 0;
let loading = null;

class SuspensionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const isReady = () => require('../utils/ensureAdminFoundations').isAdminFoundationsReady();

async function refresh() {
  if (!isReady()) return;
  loadedAt = Date.now();
  try {
    const rows = await select(
      `SELECT user_id, ends_at FROM user_suspensions
        WHERE lifted_at IS NULL AND (ends_at IS NULL OR ends_at > NOW())`
    );
    suspended = new Map(rows.map((row) => [Number(row.user_id), row.ends_at ? new Date(row.ends_at).getTime() : Infinity]));
  } catch (error) {
    console.warn('[Suspension] Could not refresh the list:', error.message);
  }
}

/** Loads the set once on boot. */
function startRefreshing() {
  refreshIfStale(true);
}

/** Single-flight reload when the set is older than MAX_AGE_MS. Never throws. */
function refreshIfStale(force = false) {
  if (loading || (!force && Date.now() - loadedAt < MAX_AGE_MS)) return;
  loading = refresh().finally(() => {
    loading = null;
  });
}

/** Fast, synchronous: safe to call on every request. */
function isSuspended(userId) {
  refreshIfStale();
  const endsAt = suspended.get(Number(userId));
  if (endsAt === undefined) return false;
  if (endsAt <= Date.now()) {
    suspended.delete(Number(userId));
    return false;
  }
  return true;
}

function suspendedUntil(userId) {
  const endsAt = suspended.get(Number(userId));
  return endsAt && endsAt !== Infinity ? new Date(endsAt) : null;
}

/** The body sent to a suspended person, so the site and app can explain it. */
function suspendedResponse(userId) {
  const until = suspendedUntil(userId);
  return {
    success: false,
    code: 'ACCOUNT_SUSPENDED',
    message: until
      ? `Your account is suspended until ${until.toUTCString()}. Contact support@hallos.net if you think this is a mistake.`
      : 'Your account is suspended. Contact support@hallos.net if you think this is a mistake.',
    suspendedUntil: until,
  };
}

const assertReady = () => {
  if (!isReady()) throw new SuspensionError(503, 'Suspensions are unavailable right now. Check the server logs.');
};

async function getOpen(userId) {
  const [row] = await select(
    `SELECT id, user_id AS "userId", reason, ends_at AS "endsAt", created_by AS "createdBy", created_at AS "createdAt"
       FROM user_suspensions
      WHERE user_id = :userId AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > NOW())`,
    { userId }
  );
  return row || null;
}

async function history(userId) {
  if (!isReady()) return [];
  return select(
    `SELECT s.id, s.reason, s.ends_at AS "endsAt", s.created_at AS "createdAt", s.lifted_at AS "liftedAt",
            s.lift_reason AS "liftReason",
            NULLIF(TRIM(CONCAT(c.firstname, ' ', c.lastname)), '') AS "createdByName",
            NULLIF(TRIM(CONCAT(l.firstname, ' ', l.lastname)), '') AS "liftedByName"
       FROM user_suspensions s
       LEFT JOIN "Users" c ON c.id = s.created_by
       LEFT JOIN "Users" l ON l.id = s.lifted_by
      WHERE s.user_id = :userId
      ORDER BY s.created_at DESC LIMIT 50`,
    { userId }
  );
}

/**
 * Super admins can't be suspended, nobody can suspend themselves, and only a
 * super admin can suspend someone who has a staff role.
 */
async function suspend({ userId, actor, reason, endsAt }) {
  assertReady();
  const id = Number(userId);
  const cleanReason = String(reason || '').trim();
  if (!Number.isInteger(id)) throw new SuspensionError(404, 'User not found');
  if (id === Number(actor.id)) throw new SuspensionError(403, 'You can’t suspend yourself.');
  if (cleanReason.length < 5) throw new SuspensionError(400, 'Give a reason so this can be understood later.');

  let until = null;
  if (endsAt) {
    until = new Date(endsAt);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now() + 60 * 1000) {
      throw new SuspensionError(400, 'The end date must be in the future.');
    }
  }

  const [target] = await select('SELECT id, role FROM "Users" WHERE id = :id', { id });
  if (!target) throw new SuspensionError(404, 'User not found');
  if (target.role === 'admin') throw new SuspensionError(403, 'Super admins can’t be suspended.');
  if (actor.role !== 'admin') {
    const [staff] = await select('SELECT 1 FROM staff_assignments WHERE user_id = :id', { id }).catch(() => []);
    if (staff) throw new SuspensionError(403, 'Only a super admin can suspend a staff member.');
  }

  if (await getOpen(id)) {
    throw new SuspensionError(409, 'This person is already suspended. Lift it first to change it.');
  }
  try {
    await sequelize.query(
      `INSERT INTO user_suspensions (user_id, reason, ends_at, created_by)
       VALUES (:id, :reason, :until, :actorId)`,
      { replacements: { id, reason: cleanReason.slice(0, 1000), until, actorId: actor.id } }
    );
  } catch (error) {
    // 23505: a suspension was added at the same moment by someone else.
    if (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505') {
      throw new SuspensionError(409, 'This person is already suspended. Lift it first to change it.');
    }
    throw error;
  }
  suspended.set(id, until ? until.getTime() : Infinity);
  console.log(`[Suspension] User ${id} suspended by ${actor.id}${until ? ` until ${until.toISOString()}` : ''}`);
  return getOpen(id);
}

async function lift({ userId, actor, reason }) {
  assertReady();
  const id = Number(userId);
  const [, meta] = await sequelize.query(
    `UPDATE user_suspensions SET lifted_at = NOW(), lifted_by = :actorId, lift_reason = :reason
      WHERE user_id = :id AND lifted_at IS NULL`,
    { replacements: { id, actorId: actor.id, reason: String(reason || '').trim().slice(0, 1000) || null } }
  );
  suspended.delete(id);
  if (!meta?.rowCount) throw new SuspensionError(409, 'This person isn’t suspended.');
  console.log(`[Suspension] User ${id} reinstated by ${actor.id}`);
  return { lifted: true };
}

/** user id -> open suspension, for the users list. */
async function openFor(userIds) {
  if (!isReady() || userIds.length === 0) return new Map();
  const rows = await select(
    `SELECT user_id, ends_at FROM user_suspensions
      WHERE user_id IN (:userIds) AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > NOW())`,
    { userIds }
  ).catch(() => []);
  return new Map(rows.map((row) => [row.user_id, { endsAt: row.ends_at }]));
}

module.exports = {
  SuspensionError,
  startRefreshing,
  isSuspended,
  suspendedResponse,
  getOpen,
  history,
  suspend,
  lift,
  openFor,
};
