const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Notes a successful login. Fire and forget: callers don't await it, and a
 * failure here must never affect signing in.
 */
function recordLogin(userId, req, method) {
  const ip = req.ip || null;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500) || null;

  sequelize
    .query(
      `INSERT INTO user_login_stats (user_id, last_login_at, login_count, last_method, last_ip, last_user_agent)
       VALUES (:userId, CURRENT_TIMESTAMP, 1, :method, :ip, :userAgent)
       ON CONFLICT (user_id) DO UPDATE
         SET last_login_at = CURRENT_TIMESTAMP,
             login_count = user_login_stats.login_count + 1,
             last_method = EXCLUDED.last_method,
             last_ip = EXCLUDED.last_ip,
             last_user_agent = EXCLUDED.last_user_agent`,
      { replacements: { userId, method, ip, userAgent } }
    )
    .catch((error) => console.warn('[UserLogin] Could not record login:', error.message));
}

/** user id -> last login, for the users list. Empty rather than failing the list. */
async function lastLoginsFor(userIds) {
  if (userIds.length === 0) return new Map();
  try {
    const rows = await sequelize.query(
      'SELECT user_id, last_login_at FROM user_login_stats WHERE user_id IN (:userIds)',
      { replacements: { userIds }, type: QueryTypes.SELECT }
    );
    return new Map(rows.map((row) => [row.user_id, row.last_login_at]));
  } catch (error) {
    console.warn('[UserLogin] Could not read last logins:', error.message);
    return new Map();
  }
}

module.exports = { recordLogin, lastLoginsFor };
