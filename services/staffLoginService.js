const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * The fast checks behind staff logins, used on sign-in and on every request:
 *
 *  - loginGate: a staff-only login (made by a super admin) signs in only from
 *    the admin app; a turned-off one can't sign in at all.
 *  - isSessionEnded: after a password reset or turning a login off, sign-ins
 *    made before that moment stop working.
 *
 * Ended sessions are kept in memory and refreshed from the database at most
 * every 30 seconds by traffic (no timers); a change made on this server applies
 * at once. Everything fails open: if the table can't be read, nobody is
 * signed out and sign-in works as before.
 */
const MAX_AGE_MS = 30 * 1000;
const isReady = () => require('../utils/ensureStaffLogins').isStaffLoginsReady();
const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

// ---------- Ended sessions ----------

/** userId -> sign-ins issued before this time (ms) are ended. Infinity = turned off. */
let cutoffs = new Map();
let loadedAt = 0;
let loading = null;

async function load() {
  try {
    const rows = await select(
      `SELECT user_id, sessions_valid_after, disabled_at FROM staff_assignments
        WHERE sessions_valid_after IS NOT NULL OR disabled_at IS NOT NULL`
    );
    cutoffs = new Map(
      rows.map((r) => [Number(r.user_id), r.disabled_at ? Infinity : new Date(r.sessions_valid_after).getTime()])
    );
  } catch (error) {
    console.warn('[StaffLogins] Could not refresh ended sessions:', error.message);
  }
  loadedAt = Date.now();
}

function refreshIfStale(force = false) {
  if (!isReady() || loading || (!force && Date.now() - loadedAt < MAX_AGE_MS)) return loading;
  loading = load().finally(() => {
    loading = null;
  });
  return loading;
}

/**
 * True if this sign-in was ended by a reset or by turning the login off.
 * `issuedMs` is the exact time the password sign-in puts in its tokens;
 * other tokens only have `iatSeconds` (whole seconds), which errs towards ending them.
 */
function isSessionEnded(userId, iatSeconds, issuedMs) {
  refreshIfStale();
  const cutoff = cutoffs.get(Number(userId));
  if (cutoff === undefined) return false;
  if (cutoff === Infinity) return true;
  const issued = Number.isFinite(Number(issuedMs)) ? Number(issuedMs) : Number(iatSeconds) * 1000;
  return !Number.isFinite(issued) || issued < cutoff;
}

/** Applies at once on this server (others pick it up within 30 seconds). */
function noteSessionsEnded(userId, at, disabled = false) {
  cutoffs.set(Number(userId), disabled ? Infinity : at.getTime());
}
function noteReactivated(userId, at) {
  cutoffs.set(Number(userId), at.getTime());
}

/** The cut-off for ending sessions: now, to the millisecond (see isSessionEnded). */
const cutoffNow = () => new Date();

// ---------- Sign-in ----------

const adminOrigin = () => {
  try {
    return new URL(String(process.env.ADMIN_APP_URL || '').trim()).origin;
  } catch {
    return null;
  }
};

/**
 * The request comes from the admin app: it says so (X-Hallos-Client: admin),
 * and a browser's Origin (which pages can't fake) matches ADMIN_APP_URL.
 */
function fromAdminApp(req) {
  if (String(req.headers['x-hallos-client'] || '').toLowerCase() !== 'admin') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser
  const expected = adminOrigin();
  return Boolean(expected) && origin === expected;
}

const STAFF_ONLY_MESSAGE = 'This is a Hallos staff login. Use it to sign in to the Hallos admin.';
const TURNED_OFF_MESSAGE = 'This staff login has been turned off. Ask a super admin.';

/**
 * Whether this account may sign in from where it's signing in. Null = yes.
 * `req` is null for sign-ins that can't come from the admin app (Google).
 */
async function loginGate(userId, req) {
  if (!isReady()) return null;
  try {
    const [row] = await select('SELECT admin_only, disabled_at FROM staff_assignments WHERE user_id = :userId', { userId });
    if (!row) return null;
    if (row.disabled_at) return { status: 403, body: { message: TURNED_OFF_MESSAGE, code: 'STAFF_LOGIN_OFF' } };
    if (row.admin_only && !(req && fromAdminApp(req))) {
      return { status: 403, body: { message: STAFF_ONLY_MESSAGE, code: 'STAFF_ONLY_LOGIN' } };
    }
    return null;
  } catch (error) {
    console.warn('[StaffLogins] Sign-in check failed; allowing as before:', error.message);
    return null;
  }
}

// ---------- Passwords ----------

// No look-alikes (0/O, 1/l/I), so a password read aloud or typed from a screen works first time.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** A strong, readable password: four groups of four, e.g. "Hq7m-Xc2P-tR9w-K4fz" (about 90 bits). */
function generatePassword() {
  const chars = Array.from({ length: 16 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

module.exports = {
  isSessionEnded,
  noteSessionsEnded,
  noteReactivated,
  cutoffNow,
  loginGate,
  fromAdminApp,
  generatePassword,
  startRefreshing: () => refreshIfStale(true),
  STAFF_ONLY_MESSAGE,
};
