const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Account deletion, done safely.
 *
 * 1. The person asks (web or app), confirming with their password (or by
 *    typing DELETE if they sign in with Google). Nothing is removed yet: there
 *    is a grace period (GRACE_DAYS) and they can cancel any time before it ends.
 * 2. When the grace period is over, a super admin completes it from the admin
 *    (people can only ask; staff can decline but not delete). It can't
 *    be completed while money is still theirs: a wallet balance, money on hold,
 *    or a payout in progress. Staff can instead decline with a note (for
 *    example "withdraw your balance first"), which is emailed to the person.
 * 3. Completing it removes who they are: name, email, phone, bio, photo, links
 *    and quiz nickname are replaced or cleared, their password stops working,
 *    and old sign-ins are refused at once. Payment records stay, as the privacy
 *    policy allows (we're required to keep them), but no longer point to a
 *    real person.
 *
 * No timers or background jobs. Deleted accounts are checked on every
 * authenticated request through an in-memory set, loaded on boot and reloaded
 * at most every 30 seconds by traffic (like suspensions). Fails open.
 */
const GRACE_DAYS = 14;
const MAX_AGE_MS = 30 * 1000;

class AccountDeletionError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const select = (sql, replacements, options = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, ...options });
const isReady = () => require('../utils/ensureAccountDeletion').isAccountDeletionReady();
const assertReady = () => {
  if (!isReady()) throw new AccountDeletionError(503, 'Account deletion is unavailable right now. Please try again later or contact support@hallos.net.');
};

// ---------- Deleted accounts: fast check for the auth middleware ----------

let deleted = new Set();
let loadedAt = 0;
let loading = null;

async function refresh() {
  if (!isReady()) return;
  loadedAt = Date.now();
  try {
    const rows = await select(`SELECT user_id FROM account_deletion_requests WHERE status = 'completed'`);
    deleted = new Set(rows.map((row) => Number(row.user_id)));
  } catch (error) {
    console.warn('[Account deletion] Could not refresh the deleted list:', error.message);
  }
}

function refreshIfStale(force = false) {
  if (loading || (!force && Date.now() - loadedAt < MAX_AGE_MS)) return;
  loading = refresh().finally(() => {
    loading = null;
  });
}

function startRefreshing() {
  refreshIfStale(true);
}

/** Fast, synchronous: safe to call on every request. */
function isDeleted(userId) {
  refreshIfStale();
  return deleted.has(Number(userId));
}

const deletedResponse = () => ({
  success: false,
  code: 'ACCOUNT_DELETED',
  message: 'This account has been deleted.',
});

// ---------- Shapes ----------

const REQUEST_FIELDS = `r.id, r.user_id AS "userId", r.status, r.reason, r.requested_at AS "requestedAt",
  r.scheduled_for AS "scheduledFor", r.cancelled_at AS "cancelledAt", r.completed_at AS "completedAt",
  r.rejected_at AS "rejectedAt", r.staff_note AS "staffNote"`;

async function openRequest(userId) {
  const [row] = await select(
    `SELECT ${REQUEST_FIELDS} FROM account_deletion_requests r WHERE r.user_id = :userId AND r.status = 'pending'`,
    { userId }
  );
  return row || null;
}

/** For the person: their open request, if any (so the site/app can show "scheduled for…" with a cancel button). */
async function statusFor(userId) {
  // needsPassword: confirm with the password, or (Google sign-in, no password) by typing DELETE.
  const [user] = await select('SELECT (password IS NOT NULL) AS "hasPassword" FROM "Users" WHERE id = :id', { id: Number(userId) });
  const needsPassword = Boolean(user?.hasPassword);
  if (!isReady()) return { available: false, request: null, graceDays: GRACE_DAYS, needsPassword };
  const request = await openRequest(Number(userId));
  return { available: true, request, graceDays: GRACE_DAYS, needsPassword };
}

// ---------- Blockers: money that is still theirs ----------

/** userId -> list of human-readable reasons the account can't be deleted yet. */
async function blockersFor(userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Number.isInteger))];
  const result = new Map(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;

  const money = (minor, currency) => (currency === 'USD' ? `$${(minor / 100).toFixed(2)}` : `₦${(minor / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`);

  const accounts = await select(
    `SELECT user_id, currency, balance_available, balance_pending FROM wallet_accounts
      WHERE user_id IN (:ids) AND (balance_available <> 0 OR balance_pending <> 0)`,
    { ids }
  ).catch(() => []);
  for (const a of accounts) {
    const list = result.get(Number(a.user_id));
    if (!list) continue;
    if (Number(a.balance_available) !== 0) list.push(`${money(Number(a.balance_available), a.currency)} in their ${a.currency} wallet`);
    if (Number(a.balance_pending) !== 0) list.push(`${money(Number(a.balance_pending), a.currency)} on hold in their ${a.currency} wallet`);
  }

  const payouts = await select(
    `SELECT user_id, COUNT(*)::int AS n FROM payouts WHERE user_id IN (:ids) AND status IN ('pending', 'processing') GROUP BY user_id`,
    { ids }
  ).catch(() => []);
  for (const p of payouts) {
    result.get(Number(p.user_id))?.push(p.n === 1 ? 'a payout still in progress' : `${p.n} payouts still in progress`);
  }
  return result;
}

// ---------- The person ----------

async function request({ userId, password, confirmText, reason }) {
  assertReady();
  const id = Number(userId);
  const [user] = await select('SELECT id, role, email, firstname, password FROM "Users" WHERE id = :id', { id });
  if (!user) throw new AccountDeletionError(404, 'Account not found.');
  if (user.role === 'admin') {
    throw new AccountDeletionError(403, 'Super admin accounts can’t be deleted this way. Ask another super admin.');
  }
  const [staff] = await select('SELECT 1 FROM staff_assignments WHERE user_id = :id', { id }).catch(() => []);
  if (staff) {
    throw new AccountDeletionError(403, 'Your account has a staff role. Ask a super admin to remove it first, then try again.');
  }

  if (user.password) {
    if (!password || !(await bcrypt.compare(String(password), user.password))) {
      // 400, not 401: the app treats any 401 as "signed out" and would end the session.
      throw new AccountDeletionError(400, 'That password isn’t right.', 'WRONG_PASSWORD');
    }
  } else if (String(confirmText || '').trim().toUpperCase() !== 'DELETE') {
    throw new AccountDeletionError(400, 'Type DELETE to confirm.', 'CONFIRM_REQUIRED');
  }

  const cleanReason = String(reason || '').trim().slice(0, 1000) || null;
  try {
    await sequelize.query(
      `INSERT INTO account_deletion_requests (user_id, reason, scheduled_for)
       VALUES (:id, :reason, NOW() + make_interval(days => :days))`,
      { replacements: { id, reason: cleanReason, days: GRACE_DAYS } }
    );
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505') {
      throw new AccountDeletionError(409, 'You’ve already asked to delete your account.');
    }
    throw error;
  }
  const created = await openRequest(id);
  console.log(`[Account deletion] User ${id} asked to delete their account (scheduled ${new Date(created.scheduledFor).toISOString()})`);

  require('../utils/email')
    .sendAccountDeletionRequestedEmail(user.email, user.firstname, created.scheduledFor)
    .catch((error) => console.warn('[Account deletion] Confirmation email failed:', error.message));
  require('./staffAlertService').notify('accounts.deletion_requested', {
    title: 'Someone asked to delete their account',
    lines: [
      `Account: ${user.firstname || 'User'} (#${id})`,
      cleanReason ? `Reason: ${cleanReason}` : null,
      `Can be deleted from: ${new Date(created.scheduledFor).toUTCString()}`,
    ],
  });
  return created;
}

async function cancel({ userId }) {
  assertReady();
  const [, meta] = await sequelize.query(
    `UPDATE account_deletion_requests SET status = 'cancelled', cancelled_at = NOW()
      WHERE user_id = :id AND status = 'pending'`,
    { replacements: { id: Number(userId) } }
  );
  if (!meta?.rowCount) throw new AccountDeletionError(409, 'There’s no deletion request to cancel.');
  console.log(`[Account deletion] User ${userId} cancelled their request`);
  return { cancelled: true };
}

// ---------- Staff ----------

const STATUSES = new Set(['pending', 'ready', 'completed', 'cancelled', 'rejected']);

/**
 * Requests for the admin queue. `ready` = pending and past the grace period.
 * Pending ones carry their blockers so staff can see at a glance what's in the way.
 */
async function list({ status } = {}) {
  assertReady();
  const filter = STATUSES.has(status) ? status : null;
  const where =
    filter === 'ready'
      ? `r.status = 'pending' AND r.scheduled_for <= NOW()`
      : filter === 'pending'
        ? `r.status = 'pending' AND r.scheduled_for > NOW()`
        : filter
          ? 'r.status = :filter'
          : 'TRUE';
  const rows = await select(
    `SELECT ${REQUEST_FIELDS},
            u.firstname, u.lastname, u.email, u.role,
            NULLIF(TRIM(CONCAT(s.firstname, ' ', s.lastname)), '') AS "handledBy"
       FROM account_deletion_requests r
       LEFT JOIN "Users" u ON u.id = r.user_id
       LEFT JOIN "Users" s ON s.id = COALESCE(r.completed_by, r.rejected_by)
      WHERE ${where}
      ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.scheduled_for ASC, r.requested_at DESC
      LIMIT 200`,
    { filter }
  );
  const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.userId);
  const blockers = await blockersFor(pendingIds);
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    requestedAt: r.requestedAt,
    scheduledFor: r.scheduledFor,
    cancelledAt: r.cancelledAt,
    completedAt: r.completedAt,
    rejectedAt: r.rejectedAt,
    staffNote: r.staffNote,
    handledBy: r.handledBy,
    ready: r.status === 'pending' && new Date(r.scheduledFor).getTime() <= now,
    blockers: r.status === 'pending' ? blockers.get(Number(r.userId)) || [] : [],
    user: { id: r.userId, name: [r.firstname, r.lastname].filter(Boolean).join(' ') || 'Unknown', email: r.email, role: r.role },
  }));
}

async function pendingById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new AccountDeletionError(404, 'Request not found.');
  const [row] = await select(`SELECT ${REQUEST_FIELDS} FROM account_deletion_requests r WHERE r.id = :id`, { id });
  if (!row) throw new AccountDeletionError(404, 'Request not found.');
  if (row.status !== 'pending') throw new AccountDeletionError(409, `This request is already ${row.status}.`);
  return row;
}

/** Optional personal columns on "Users" that are cleared if the database has them. */
const CLEARABLE_USER_COLUMNS = ['phone_number', 'country', 'bio', 'username', 'date_of_birth', 'gender', 'address', 'city', 'state', 'google_id', 'facebook_id', 'apple_id', 'profile_picture', 'avatar', 'avatar_url'];

async function anonymizeUser(userId, transaction) {
  const columns = await select(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Users'`,
    {},
    { transaction }
  );
  const has = new Map(columns.map((c) => [c.column_name, c.is_nullable === 'YES']));
  const sets = [
    'firstname = :firstname',
    'lastname = :lastname',
    'email = :email',
    'password = :password',
  ];
  if (has.has('social_links')) sets.push(`social_links = '{}'::jsonb`);
  if (has.has('newsletter_subscribed')) sets.push('newsletter_subscribed = FALSE');
  if (has.has('updatedAt')) sets.push('"updatedAt" = NOW()');
  for (const column of CLEARABLE_USER_COLUMNS) {
    if (has.get(column) === true) sets.push(`"${column}" = NULL`);
  }
  const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  await sequelize.query(`UPDATE "Users" SET ${sets.join(', ')} WHERE id = :id`, {
    replacements: {
      id: userId,
      firstname: 'Deleted',
      lastname: 'user',
      // .invalid never delivers, and the random part keeps it unique.
      email: `deleted-${userId}-${crypto.randomBytes(4).toString('hex')}@deleted.hallos.invalid`,
      password: unusablePassword,
    },
    transaction,
  });

  // Quiz leaderboards show a nickname and avatar.
  await sequelize
    .query(`UPDATE user_quiz_stats SET nickname = 'Deleted player', avatar_url = NULL WHERE user_id = :id`, { replacements: { id: userId }, transaction })
    .catch(() => {}); // optional table
}

async function complete({ id, actor }) {
  assertReady();
  // Also enforced by the route; checked here too so no other caller can skip it.
  if (actor?.role !== 'admin') throw new AccountDeletionError(403, 'Only a super admin can delete an account.');
  const req = await pendingById(id);
  const userId = Number(req.userId);
  if (new Date(req.scheduledFor).getTime() > Date.now()) {
    throw new AccountDeletionError(409, `They can still change their mind until ${new Date(req.scheduledFor).toUTCString()}. Complete it after that.`);
  }
  const blockers = (await blockersFor([userId])).get(userId) || [];
  if (blockers.length) {
    throw new AccountDeletionError(409, `Can’t delete yet: ${blockers.join(', ')}. Decline it with a note asking them to withdraw first, or wait until it clears.`);
  }
  const [user] = await select('SELECT id, role, email, firstname FROM "Users" WHERE id = :userId', { userId });
  if (!user) throw new AccountDeletionError(404, 'That account no longer exists.');
  if (user.role === 'admin') throw new AccountDeletionError(403, 'Super admin accounts can’t be deleted.');
  const [staff] = await select('SELECT 1 FROM staff_assignments WHERE user_id = :userId', { userId }).catch(() => []);
  if (staff) throw new AccountDeletionError(409, 'They have a staff role now. Remove it first.');

  await sequelize.transaction(async (transaction) => {
    const [, meta] = await sequelize.query(
      `UPDATE account_deletion_requests SET status = 'completed', completed_at = NOW(), completed_by = :actorId
        WHERE id = :id AND status = 'pending'`,
      { replacements: { id: req.id, actorId: actor.id }, transaction }
    );
    if (!meta?.rowCount) throw new AccountDeletionError(409, 'Someone else just handled this request.');
    await anonymizeUser(userId, transaction);
  });
  deleted.add(userId);

  // Sign-up leftovers tied to the old address.
  sequelize.query('DELETE FROM pending_signups WHERE email = :email', { replacements: { email: user.email } }).catch(() => {});
  require('../utils/email')
    .sendAccountDeletedEmail(user.email, user.firstname)
    .catch((error) => console.warn('[Account deletion] Goodbye email failed:', error.message));
  console.log(`[Account deletion] User ${userId} deleted by staff ${actor.id}`);
  return { completed: true };
}

async function reject({ id, actor, note }) {
  assertReady();
  const cleanNote = String(note || '').trim();
  if (cleanNote.length < 5) throw new AccountDeletionError(400, 'Add a note for them explaining why (it’s emailed to them).');
  const req = await pendingById(id);
  const [, meta] = await sequelize.query(
    `UPDATE account_deletion_requests SET status = 'rejected', rejected_at = NOW(), rejected_by = :actorId, staff_note = :note
      WHERE id = :id AND status = 'pending'`,
    { replacements: { id: req.id, actorId: actor.id, note: cleanNote.slice(0, 1000) } }
  );
  if (!meta?.rowCount) throw new AccountDeletionError(409, 'Someone else just handled this request.');
  const [user] = await select('SELECT email, firstname FROM "Users" WHERE id = :userId', { userId: req.userId });
  if (user) {
    require('../utils/email')
      .sendAccountDeletionDeclinedEmail(user.email, user.firstname, cleanNote)
      .catch((error) => console.warn('[Account deletion] Declined email failed:', error.message));
  }
  console.log(`[Account deletion] Request ${req.id} declined by staff ${actor.id}`);
  return { rejected: true };
}

/** For a user's admin page: their open request, if any. */
async function openForUser(userId) {
  if (!isReady()) return null;
  return openRequest(Number(userId));
}

module.exports = {
  GRACE_DAYS,
  AccountDeletionError,
  startRefreshing,
  isDeleted,
  deletedResponse,
  statusFor,
  request,
  cancel,
  list,
  complete,
  reject,
  openForUser,
  blockersFor,
};
