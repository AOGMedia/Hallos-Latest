const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const { isInvestorRelationsReady } = require('../utils/ensureInvestorRelations');

/**
 * Investor relations profiles: staff add, edit, reorder and hide them from the
 * admin; the site shows the published ones in order. Public reads are cached
 * in memory for 30 seconds and refreshed by traffic (no timers); any change
 * refreshes the cache at once on this server.
 */
const MAX_AGE_MS = 30 * 1000;
const MAX_PROFILES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class InvestorError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const assertReady = () => {
  if (!isInvestorRelationsReady()) throw new InvestorError(503, 'Investor relations are unavailable right now. Check the server logs.');
};

const COLUMNS = `p.id, p.name, p.role, p.location, p.website_label AS "websiteLabel", p.website_url AS "websiteUrl",
  p.email, p.linkedin_url AS "linkedinUrl", p.image_url AS "imageUrl", p.bio, p.position,
  p.is_published AS "isPublished", p.updated_at AS "updatedAt"`;

// ---------- Public ----------

let cache = { at: 0, profiles: null };
let loading = null;

async function loadPublished() {
  const profiles = await select(
    `SELECT ${COLUMNS} FROM investor_profiles p WHERE p.is_published ORDER BY p.position, p.created_at`
  );
  // Only what the page shows.
  cache = {
    at: Date.now(),
    profiles: profiles.map(({ isPublished, updatedAt, position, ...rest }) => rest),
  };
}

function refresh(force = false) {
  if (loading || (!force && cache.profiles && Date.now() - cache.at < MAX_AGE_MS)) return loading;
  loading = loadPublished()
    .catch((error) => {
      cache.at = Date.now(); // don't hammer a failing database; keep what we had
      console.warn('[InvestorRelations] Could not load profiles:', error.message);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Published profiles in order, or null if they can't be read (the site then keeps its built-in one). */
async function listPublished() {
  if (!isInvestorRelationsReady()) return null;
  if (!cache.profiles) await refresh(true);
  else refresh();
  return cache.profiles;
}

// ---------- Validation ----------

const text = (value, field, { max, min = 1, optional = false } = {}) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (optional) return null;
    throw new InvestorError(400, `${field} can't be empty.`, field);
  }
  if (s.length < min) throw new InvestorError(400, `${field} is too short.`, field);
  if (s.length > max) throw new InvestorError(400, `${field} must be ${max} characters or fewer.`, field);
  return s;
};

/** https web address (or a site path for photos). Never javascript: or data:. */
const link = (value, field, { optional = false, allowPath = false, host } = {}) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (optional) return null;
    throw new InvestorError(400, `${field} is required.`, field);
  }
  if (s.length > 500) throw new InvestorError(400, `${field} is too long.`, field);
  if (allowPath && /^\/(?!\/)[\w\-./%]+$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.protocol === 'https:' && (!host || url.hostname === host || url.hostname.endsWith(`.${host}`))) return url.toString();
  } catch {}
  throw new InvestorError(
    400,
    host ? `${field} must be a ${host} link starting with https://.` : `${field} must start with https://${allowPath ? ' or be a path like /images/photo.png' : ''}.`,
    field
  );
};

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvestorError(400, 'Send the profile.');
  const email = text(input.email, 'Email', { max: 255, optional: true });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new InvestorError(400, 'Email doesn’t look right.', 'Email');
  const websiteUrl = link(input.websiteUrl, 'Website', { optional: true });
  let websiteLabel = text(input.websiteLabel, 'Website text', { max: 120, optional: true });
  // Show the address itself if no text was given.
  if (websiteUrl && !websiteLabel) websiteLabel = new URL(websiteUrl).hostname.replace(/^www\./, '');
  return {
    name: text(input.name, 'Name', { max: 120, min: 2 }),
    role: text(input.role, 'Role', { max: 80 }),
    location: text(input.location, 'Location', { max: 120, optional: true }),
    websiteLabel: websiteUrl ? websiteLabel : null,
    websiteUrl,
    email: email ? email.toLowerCase() : null,
    linkedinUrl: link(input.linkedinUrl, 'LinkedIn', { optional: true, host: 'linkedin.com' }),
    imageUrl: link(input.imageUrl, 'Photo', { allowPath: true }),
    bio: text(input.bio, 'Bio', { max: 8000, min: 20 }),
    isPublished: input.isPublished !== false,
  };
}

// ---------- Admin ----------

async function listAll() {
  assertReady();
  return select(`SELECT ${COLUMNS} FROM investor_profiles p ORDER BY p.position, p.created_at`);
}

async function getOne(id) {
  if (!UUID.test(String(id))) throw new InvestorError(404, 'Profile not found.');
  const [row] = await select(`SELECT ${COLUMNS} FROM investor_profiles p WHERE p.id = :id`, { id });
  if (!row) throw new InvestorError(404, 'Profile not found.');
  return row;
}

async function create(input, actor) {
  assertReady();
  const p = validate(input);
  const [{ count, next }] = await select('SELECT COUNT(*)::int AS count, COALESCE(MAX(position), -1) + 1 AS next FROM investor_profiles');
  if (count >= MAX_PROFILES) throw new InvestorError(400, `There can be at most ${MAX_PROFILES} profiles.`);
  const [row] = await select(
    `INSERT INTO investor_profiles (name, role, location, website_label, website_url, email, linkedin_url, image_url, bio, is_published, position, created_by, updated_by)
     VALUES (:name, :role, :location, :websiteLabel, :websiteUrl, :email, :linkedinUrl, :imageUrl, :bio, :isPublished, :position, :actorId, :actorId)
     RETURNING id`,
    { ...p, position: next, actorId: actor.id }
  );
  await refresh(true);
  return getOne(row.id);
}

async function update(id, input, actor) {
  assertReady();
  await getOne(id);
  const p = validate(input);
  await sequelize.query(
    `UPDATE investor_profiles SET name = :name, role = :role, location = :location, website_label = :websiteLabel,
            website_url = :websiteUrl, email = :email, linkedin_url = :linkedinUrl, image_url = :imageUrl, bio = :bio,
            is_published = :isPublished, updated_by = :actorId, updated_at = NOW()
      WHERE id = :id`,
    { replacements: { ...p, id, actorId: actor.id } }
  );
  await refresh(true);
  return getOne(id);
}

async function remove(id) {
  assertReady();
  await getOne(id);
  await sequelize.query('DELETE FROM investor_profiles WHERE id = :id', { replacements: { id } });
  await refresh(true);
}

/** Saves a new order: `ids` must list every profile exactly once. */
async function reorder(ids, actor) {
  assertReady();
  if (!Array.isArray(ids) || ids.some((id) => !UUID.test(String(id)))) throw new InvestorError(400, 'Send the profiles in their new order.');
  const current = await select('SELECT id FROM investor_profiles');
  const known = new Set(current.map((r) => r.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new InvestorError(409, 'The list changed while you were reordering. Reload and try again.');
  }
  await sequelize.transaction(async (transaction) => {
    for (const [position, id] of ids.entries()) {
      await sequelize.query('UPDATE investor_profiles SET position = :position, updated_by = :actorId WHERE id = :id', {
        replacements: { position, id, actorId: actor.id },
        transaction,
      });
    }
  });
  await refresh(true);
  return listAll();
}

module.exports = { InvestorError, listPublished, listAll, create, update, remove, reorder, validate, MAX_PROFILES };
