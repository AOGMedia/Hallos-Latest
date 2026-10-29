/**
 * Reads the client's idempotency key for a create request.
 *
 * Body only (works for both JSON and multipart — multer puts text fields on
 * req.body). Deliberately not a custom header: a new header would trigger a
 * CORS preflight, and any origin config that doesn't list it would block
 * every create request outright.
 *
 * Must be a UUID. Anything else (missing, malformed, oversized) returns null,
 * which the controllers treat as "no key" — the pre-existing behavior — so
 * older clients and other callers keep working unchanged.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readIdempotencyKey = (req) => {
  const raw = req.body?.idempotencyKey;
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  return UUID_RE.test(key) ? key.toLowerCase() : null;
};

/** True for a Postgres unique violation on the given index. */
const isIdempotencyConflict = (error, indexName) =>
  error?.name === 'SequelizeUniqueConstraintError' &&
  (
    error?.parent?.constraint === indexName ||
    error?.original?.constraint === indexName ||
    Object.prototype.hasOwnProperty.call(error?.fields || {}, 'idempotency_key')
  );

module.exports = { readIdempotencyKey, isIdempotencyConflict };
