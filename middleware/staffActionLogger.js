const sequelize = require('../config/db');

/**
 * Records every successful change made through an admin or staff route: who,
 * what, when, from where. Mounted once in server.js, so no existing controller
 * changes. Writing happens after the response is sent and never blocks or
 * breaks the request.
 *
 * Secrets in request bodies (passwords, tokens, keys, account numbers) are
 * replaced before saving, and long text is shortened.
 */
const STAFF_PATHS = [
  /^\/api\/admin\//,
  /^\/api\/staff\//,
  /^\/api\/email-portal\/(?!t\/|webhooks\/|unsubscribe)/,
  /^\/api\/quiz\/admin\//,
  /^\/api\/blog\/admin\//,
  /^\/api\/referral\/admin\//,
  /^\/api\/ugc\/admin\//,
  /^\/api\/feedback\/admin\//,
  /^\/api\/notifications\/digest\//,
];

/** POSTs that only read or check something; not worth logging. */
const READ_ONLY = [
  /\/transactions\/search\/?$/,
  /\/audit\/(report|verify)\/?$/,
  /\/fraud-detection\/analyze\/?$/,
  /\/withdrawal-limits\/check-limits\/?$/,
  /\/email-portal\/audience\/(preview|users)\/?$/,
];

const SECRET_KEY = /pass(word)?|token|secret|api_?key|otp|pin|cvv|card|account_?number|authorization/i;
const MAX_TEXT = 300;

function clean(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}… (${value.length} chars)` : value;
  if (typeof value !== 'object') return value;
  if (depth > 3) return '[nested]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => clean(item, depth + 1));
    return value.length > 20 ? [...items, `… ${value.length - 20} more`] : items;
  }
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    out[key] = SECRET_KEY.test(key) ? '[hidden]' : /html$/i.test(key) && typeof item === 'string' ? `[${item.length} chars of HTML]` : clean(item, depth + 1);
  }
  return out;
}

function isStaffChange(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const path = req.originalUrl.split('?')[0];
  return STAFF_PATHS.some((pattern) => pattern.test(path)) && !READ_ONLY.some((pattern) => pattern.test(path));
}

function staffActionLogger(req, res, next) {
  if (!isStaffChange(req)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user?.id) return;
    if (!require('../utils/ensureAdminFoundations').isAdminFoundationsReady()) return;
    const details = { body: clean(req.body || {}) };
    if (req.file) details.file = { name: req.file.originalname, size: req.file.size, type: req.file.mimetype };
    const query = { ...req.query };
    delete query.secret;
    if (Object.keys(query).length) details.query = clean(query);
    sequelize
      .query(
        `INSERT INTO admin_action_log (actor_id, actor_role, method, path, status, details, ip, user_agent)
         VALUES (:actorId, :actorRole, :method, :path, :status, CAST(:details AS JSONB), :ip, :userAgent)`,
        {
          replacements: {
            actorId: req.user.id,
            actorRole: req.user.role || null,
            method: req.method,
            path: req.originalUrl.split('?')[0].slice(0, 500),
            status: res.statusCode,
            details: JSON.stringify(details),
            ip: String(req.ip || '').slice(0, 64) || null,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
          },
        }
      )
      .catch((error) => console.warn('[StaffActionLog] Could not record:', error.message));
  });
  return next();
}

module.exports = staffActionLogger;
