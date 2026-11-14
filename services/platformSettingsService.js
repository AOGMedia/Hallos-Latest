/**
 * Business values staff can change without a redeploy.
 *
 * Every setting has a default equal to what the code did before (environment
 * variable or hard-coded value), so nothing changes until a super admin edits
 * one. Edits are validated against sensible bounds and every change is kept
 * in a history table, alongside the staff action log.
 *
 * Reads are synchronous from an in-memory copy, refreshed by traffic at most
 * every 30 seconds (no timers) and immediately on change. If storage isn't
 * available, the defaults apply — exactly the old behaviour.
 */
const sequelize = require('../config/db');

class SettingsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** key → definition. `default` reproduces the behaviour before settings existed. */
const REGISTRY = [
  { key: 'course_price_individual_ngn', group: 'courses', label: 'Single course', type: 'money', currency: 'NGN', min: 100, max: 100000000, default: () => int(process.env.COURSE_PRICE_INDIVIDUAL_NGN, 0) || 25000 },
  { key: 'course_price_individual_usd', group: 'courses', label: 'Single course', type: 'money', currency: 'USD', min: 1, max: 100000, default: () => int(process.env.COURSE_PRICE_INDIVIDUAL_USD, 0) || 30 },
  { key: 'course_price_monthly_ngn', group: 'courses', label: 'All courses, monthly', type: 'money', currency: 'NGN', min: 100, max: 100000000, default: () => int(process.env.COURSE_PRICE_MONTHLY_NGN, 0) || 35000 },
  { key: 'course_price_monthly_usd', group: 'courses', label: 'All courses, monthly', type: 'money', currency: 'USD', min: 1, max: 100000, default: () => int(process.env.COURSE_PRICE_MONTHLY_USD, 0) || 42 },
  { key: 'course_price_yearly_ngn', group: 'courses', label: 'All courses, yearly', type: 'money', currency: 'NGN', min: 100, max: 100000000, default: () => int(process.env.COURSE_PRICE_YEARLY_NGN, 0) || 280000 },
  { key: 'course_price_yearly_usd', group: 'courses', label: 'All courses, yearly', type: 'money', currency: 'USD', min: 1, max: 100000, default: () => int(process.env.COURSE_PRICE_YEARLY_USD, 0) || 336 },
  {
    key: 'withdrawal_fee_percent', group: 'withdrawals', label: 'Hallos fee on withdrawals', type: 'percent', min: 0, max: 50,
    help: 'Taken from each creator withdrawal before gateway fees.',
    default: () => Math.round((parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.1) * 10000) / 100,
  },
  { key: 'min_topup_ngn', group: 'wallet', label: 'Smallest wallet top-up', type: 'money', currency: 'NGN', min: 100, max: 1000000, default: () => 1000 },
  { key: 'min_topup_usd', group: 'wallet', label: 'Smallest wallet top-up', type: 'money', currency: 'USD', min: 1, max: 10000, default: () => 1 },
  {
    key: 'gift_host_share_percent', group: 'gifts', label: 'Host’s share of live gifts', type: 'percent', min: 0, max: 100,
    help: 'The rest is Hallos’s fee.',
    default: () => 80,
  },
];
const BY_KEY = new Map(REGISTRY.map((s) => [s.key, s]));
const GROUPS = [
  { key: 'courses', label: 'Course prices', description: 'What buyers pay for course access. Applies to new purchases.' },
  { key: 'withdrawals', label: 'Withdrawals', description: 'Applies to withdrawals requested from now on.' },
  { key: 'wallet', label: 'Wallet top-ups', description: 'Smaller top-ups are refused.' },
  { key: 'gifts', label: 'Live gifts', description: 'How gift money is split between the host and Hallos.' },
];

const MAX_AGE_MS = 30 * 1000;
let ready = false;
let overrides = new Map();
let loadedAt = 0;
let loading = null;

async function load() {
  const [rows] = await sequelize.query('SELECT key, value FROM platform_settings');
  const next = new Map();
  for (const row of rows) {
    const def = BY_KEY.get(row.key);
    const value = Number(row.value);
    if (def && Number.isFinite(value) && value >= def.min && value <= def.max) next.set(row.key, value);
  }
  overrides = next;
  loadedAt = Date.now();
}

function refreshIfStale() {
  if (!ready || loading || Date.now() - loadedAt < MAX_AGE_MS) return;
  loading = load()
    .catch((error) => console.error('[Settings] Refresh failed; keeping the last known values:', error.message))
    .finally(() => { loading = null; });
}

/** The current value of a setting. Never throws for a known key. */
function get(key) {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  refreshIfStale();
  return overrides.has(key) ? overrides.get(key) : def.default();
}

/** Percent settings as a fraction (10 → 0.1). */
const fraction = (key) => get(key) / 100;

async function start() {
  await load();
  ready = true;
}

const assertReady = () => {
  if (!ready) throw new SettingsError(503, 'Settings are unavailable right now. Check the server logs.');
};

async function list() {
  assertReady();
  await load();
  const [meta] = await sequelize.query(
    `SELECT s.key, s.updated_at, u.firstname, u.lastname FROM platform_settings s LEFT JOIN "Users" u ON u.id = s.updated_by`
  );
  const metaByKey = new Map(meta.map((m) => [m.key, m]));
  const [changes] = await sequelize.query(
    `SELECT c.key, c.from_value, c.to_value, c.note, c.created_at, u.firstname, u.lastname
       FROM platform_setting_changes c LEFT JOIN "Users" u ON u.id = c.changed_by
      ORDER BY c.created_at DESC LIMIT 30`
  );
  const name = (r) => [r?.firstname, r?.lastname].filter(Boolean).join(' ') || null;
  return {
    groups: GROUPS.map((group) => ({
      ...group,
      settings: REGISTRY.filter((s) => s.group === group.key).map((s) => ({
        key: s.key,
        label: s.label,
        help: s.help ?? null,
        type: s.type,
        currency: s.currency ?? null,
        min: s.min,
        max: s.max,
        value: get(s.key),
        defaultValue: s.default(),
        isCustom: overrides.has(s.key),
        updatedAt: metaByKey.get(s.key)?.updated_at ?? null,
        updatedBy: name(metaByKey.get(s.key)),
      })),
    })),
    changes: changes.map((c) => ({
      key: c.key,
      label: BY_KEY.get(c.key)?.label ?? c.key,
      currency: BY_KEY.get(c.key)?.currency ?? null,
      type: BY_KEY.get(c.key)?.type ?? 'money',
      from: c.from_value === null ? null : Number(c.from_value),
      to: c.to_value === null ? null : Number(c.to_value),
      note: c.note,
      by: name(c),
      at: c.created_at,
    })),
  };
}

async function recordChange({ key, from, to, note, actor }, transaction) {
  await sequelize.query(
    `INSERT INTO platform_setting_changes (key, from_value, to_value, note, changed_by) VALUES (:key, :from, :to, :note, :actor)`,
    { replacements: { key, from, to, note: String(note || '').trim().slice(0, 500) || null, actor: actor.id }, transaction }
  );
}

async function set({ key, value, note, actor }) {
  assertReady();
  const def = BY_KEY.get(key);
  if (!def) throw new SettingsError(404, 'Unknown setting.');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new SettingsError(400, 'Enter a number.');
  const rounded = Math.round(number * 100) / 100;
  if (rounded < def.min || rounded > def.max) {
    throw new SettingsError(400, `Choose a value between ${def.min} and ${def.max}${def.type === 'percent' ? '%' : ` ${def.currency}`}.`);
  }
  const from = get(key);
  if (rounded === from && overrides.has(key)) return list();
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (:key, :value, :actor, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      { replacements: { key, value: rounded, actor: actor.id }, transaction }
    );
    await recordChange({ key, from, to: rounded, note, actor }, transaction);
  });
  overrides = new Map(overrides).set(key, rounded);
  console.log(`[Settings] ${key}: ${from} → ${rounded} by user ${actor.id}`);
  return list();
}

/** Back to the built-in default. */
async function reset({ key, actor }) {
  assertReady();
  const def = BY_KEY.get(key);
  if (!def) throw new SettingsError(404, 'Unknown setting.');
  if (!overrides.has(key)) return list();
  const from = get(key);
  await sequelize.transaction(async (transaction) => {
    await sequelize.query('DELETE FROM platform_settings WHERE key = :key', { replacements: { key }, transaction });
    await recordChange({ key, from, to: def.default(), note: 'Back to default', actor }, transaction);
  });
  const next = new Map(overrides);
  next.delete(key);
  overrides = next;
  return list();
}

module.exports = { get, fraction, start, list, set, reset, SettingsError, isReady: () => ready };
