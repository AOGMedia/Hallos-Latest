/**
 * Live and test mode for Paystack and Stripe.
 *
 * The standard rules this follows:
 *   - Each gateway has a live key pair and a test key pair. Keys stay in the
 *     environment; staff only ever switch which pair checkouts use.
 *   - Test money never mixes with real money. A test payment can unlock what
 *     was bought (so the whole flow can be tried), but it never credits a
 *     creator, a partner or a wallet top-up, so nothing test-paid can ever be
 *     withdrawn or spent. Each gateway says whether a payment was test
 *     (Stripe: livemode, Paystack: domain), so that's what decides — not the
 *     current setting.
 *   - Payouts, withdrawals and anything that isn't a buyer checkout always use
 *     the live keys, whatever the setting.
 *
 * Two ways to test:
 *   - Test accounts: chosen people always check out in test mode while
 *     everyone else keeps paying for real. The safe way to test on the live site.
 *   - Whole gateway in test mode: every checkout on that gateway uses test keys.
 *
 * Which keys a request uses is decided per request through AsyncLocalStorage:
 * checkout routes run inside a "checkout" context (see paymentModeContext
 * middleware), webhooks inside the mode the gateway signed them with, and
 * refunds inside the mode of the payment being refunded. Outside those, live.
 *
 * Settings are cached in memory and refreshed by traffic at most every 30
 * seconds (no timers), and immediately on change. If storage isn't available,
 * everything stays live — exactly the behaviour before this existed.
 */
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const sequelize = require('../config/db');

class GatewayModeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const GATEWAYS = ['paystack', 'stripe'];
const MODES = ['live', 'test'];
const MAX_AGE_MS = 30 * 1000;

const context = new AsyncLocalStorage();
let ready = false;
let modes = { paystack: 'live', stripe: 'live' };
let testers = new Set();
let loadedAt = 0;
let loading = null;

// --- Keys ---------------------------------------------------------------------------

const KEYS = {
  paystack: {
    live: () => process.env.PAYSTACK_SECRET_KEY,
    test: () => process.env.PAYSTACK_TEST_SECRET_KEY,
    // Paystack signs webhooks with the secret key of the mode that sent them.
    webhook: { live: () => process.env.PAYSTACK_WEBHOOK_SECRET, test: () => process.env.PAYSTACK_TEST_SECRET_KEY },
  },
  stripe: {
    live: () => process.env.STRIPE_SECRET_KEY,
    test: () => process.env.STRIPE_TEST_SECRET_KEY,
    // Stripe gives each webhook endpoint its own signing secret, per mode.
    webhook: { live: () => process.env.STRIPE_WEBHOOK_SECRET, test: () => process.env.STRIPE_TEST_WEBHOOK_SECRET },
  },
};

const hasTestKeys = (gateway) => Boolean(KEYS[gateway].test());

// --- Which mode applies right now -------------------------------------------------

/**
 * The mode the current request should use for a gateway. Only checkout,
 * webhook and refund contexts can ever be test; everything else is live.
 */
function modeFor(gateway) {
  const store = context.getStore();
  if (!store) return 'live';
  if (store.fixed?.[gateway]) return store.fixed[gateway];
  if (store.checkout) return store.tester ? 'test' : modes[gateway] === 'test' ? 'test' : 'live';
  return 'live';
}

/** The secret key for the current request. Never falls back from test to live: that would charge real money. */
function secretKeyFor(gateway) {
  const mode = modeFor(gateway);
  const key = KEYS[gateway][mode]();
  if (!key && mode === 'test') {
    throw new GatewayModeError(503, `${gateway === 'stripe' ? 'Stripe' : 'Paystack'} test payments aren’t set up on the server yet.`);
  }
  return key;
}

const webhookSecretFor = (gateway) => KEYS[gateway].webhook[modeFor(gateway)]();

/** Run fn with a gateway pinned to a mode (webhooks, refunds). */
const runFixed = (gateway, mode, fn) => context.run({ ...(context.getStore() || {}), fixed: { [gateway]: mode === 'test' ? 'test' : 'live' } }, fn);

/** Run fn as a buyer checkout: test accounts and gateways switched to test use test keys. */
const runCheckout = (userId, fn) => {
  refreshIfStale();
  return context.run({ checkout: true, tester: userId != null && testers.has(Number(userId)) }, fn);
};

/** Whether the gateway's own payment object says it was a test payment. */
function isTestPayment(gateway, data) {
  if (!data || typeof data !== 'object') return false;
  if (gateway === 'stripe') return data.livemode === false;
  if (gateway === 'paystack') return String(data.domain || '').toLowerCase() === 'test';
  return false;
}

/** Which mode signed a Paystack webhook: live, test, or null if neither. */
function paystackWebhookMode(rawBody, signature) {
  if (!signature) return null;
  for (const mode of MODES) {
    const secret = KEYS.paystack.webhook[mode]();
    if (!secret) continue;
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    if (expected.length === String(signature).length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))) return mode;
  }
  return null;
}

/** Which mode signed a Stripe webhook, using Stripe's own verifier. */
function stripeWebhookMode(stripeWebhooks, payload, signature) {
  for (const mode of MODES) {
    const secret = KEYS.stripe.webhook[mode]();
    if (!secret) continue;
    try {
      stripeWebhooks.constructEvent(payload, signature, secret);
      return mode;
    } catch {
      // try the other mode
    }
  }
  return null;
}

// --- Storage --------------------------------------------------------------------------

async function load() {
  const [settings] = await sequelize.query('SELECT gateway, mode FROM gateway_settings');
  const [accounts] = await sequelize.query('SELECT user_id FROM payment_test_accounts');
  const next = { paystack: 'live', stripe: 'live' };
  for (const row of settings) {
    // A gateway whose test keys were removed falls back to live.
    if (GATEWAYS.includes(row.gateway) && row.mode === 'test' && hasTestKeys(row.gateway)) next[row.gateway] = 'test';
  }
  modes = next;
  testers = new Set(accounts.map((r) => Number(r.user_id)));
  loadedAt = Date.now();
}

function refreshIfStale() {
  if (!ready || loading || Date.now() - loadedAt < MAX_AGE_MS) return;
  loading = load()
    .catch((error) => console.error('[Gateway mode] Refresh failed; keeping the last known settings:', error.message))
    .finally(() => { loading = null; });
}

async function start() {
  await load();
  ready = true;
  const test = GATEWAYS.filter((g) => modes[g] === 'test');
  if (test.length) console.warn(`⚠️ Payments in TEST mode for: ${test.join(', ')}`);
}

const assertReady = () => {
  if (!ready) throw new GatewayModeError(503, 'Payment settings are unavailable right now. Check the server logs.');
};

/** Remember a test payment, so staff can see it and refunds use test keys. Never throws. */
async function recordTestPayment({ reference, gateway, kind, userId, amount, currency }) {
  if (!reference) return;
  try {
    await sequelize.query(
      `INSERT INTO test_payments (reference, gateway, kind, user_id, amount, currency)
       VALUES (:reference, :gateway, :kind, :userId, :amount, :currency) ON CONFLICT (reference) DO NOTHING`,
      { replacements: { reference, gateway, kind, userId: userId ?? null, amount: amount ?? null, currency: currency ?? null } }
    );
  } catch (error) {
    console.error('[Gateway mode] Could not record a test payment:', error.message);
  }
}

/** The mode a stored payment was made in. */
async function modeOfPayment(gateway, reference) {
  if (gateway === 'stripe' && /^(cs|pi|ch)_test_/.test(String(reference))) return 'test';
  if (gateway === 'stripe' && /^(cs|pi|ch)_live_/.test(String(reference))) return 'live';
  try {
    const [rows] = await sequelize.query('SELECT 1 FROM test_payments WHERE reference = :reference', { replacements: { reference } });
    return rows.length ? 'test' : 'live';
  } catch {
    return 'live';
  }
}

async function testReferences(references) {
  if (!references.length) return new Set();
  try {
    const [rows] = await sequelize.query('SELECT reference FROM test_payments WHERE reference IN (:references)', { replacements: { references } });
    return new Set(rows.map((r) => r.reference));
  } catch {
    return new Set();
  }
}

// --- Staff settings ---------------------------------------------------------------------

function describeKey(value, expectedPrefix) {
  if (!value) return { configured: false, hint: null, looksRight: false };
  return { configured: true, hint: `${value.slice(0, 8)}…${value.slice(-4)}`, looksRight: value.startsWith(expectedPrefix) };
}

async function getSettings() {
  assertReady();
  await load();
  const [accounts] = await sequelize.query(
    `SELECT t.user_id, t.created_at, u.firstname, u.lastname, u.email
       FROM payment_test_accounts t LEFT JOIN "Users" u ON u.id = t.user_id ORDER BY t.created_at DESC`
  );
  const [changes] = await sequelize.query(
    `SELECT c.gateway, c.from_mode, c.to_mode, c.note, c.created_at, u.firstname, u.lastname
       FROM gateway_mode_changes c LEFT JOIN "Users" u ON u.id = c.changed_by
      ORDER BY c.created_at DESC LIMIT 20`
  );
  const [recent] = await sequelize.query(
    `SELECT gateway, COUNT(*)::int AS count, MAX(created_at) AS last FROM test_payments
      WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY gateway`
  );
  const name = (r) => [r.firstname, r.lastname].filter(Boolean).join(' ') || null;
  return {
    gateways: GATEWAYS.map((gateway) => ({
      gateway,
      currency: gateway === 'stripe' ? 'USD' : 'NGN',
      mode: modes[gateway],
      liveKey: describeKey(KEYS[gateway].live(), 'sk_live_'),
      testKey: describeKey(KEYS[gateway].test(), 'sk_test_'),
      testWebhookReady: gateway === 'stripe' ? Boolean(KEYS.stripe.webhook.test()) : Boolean(KEYS.paystack.test()),
      canUseTest: hasTestKeys(gateway),
      testPaymentsLast30Days: recent.find((r) => r.gateway === gateway)?.count ?? 0,
    })),
    testAccounts: accounts.map((r) => ({ userId: Number(r.user_id), name: name(r), email: r.email, addedAt: r.created_at })),
    changes: changes.map((r) => ({ gateway: r.gateway, from: r.from_mode, to: r.to_mode, note: r.note, by: name(r), at: r.created_at })),
  };
}

async function setMode({ gateway, mode, note, actor }) {
  assertReady();
  if (!GATEWAYS.includes(gateway)) throw new GatewayModeError(404, 'Unknown payment gateway.');
  if (!MODES.includes(mode)) throw new GatewayModeError(400, 'Choose live or test.');
  if (mode === 'test' && !hasTestKeys(gateway)) {
    throw new GatewayModeError(409, `Add ${gateway === 'stripe' ? 'STRIPE_TEST_SECRET_KEY' : 'PAYSTACK_TEST_SECRET_KEY'} on the server first.`);
  }
  const from = modes[gateway];
  if (from === mode) return getSettings();
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `INSERT INTO gateway_settings (gateway, mode, updated_by, updated_at) VALUES (:gateway, :mode, :actor, NOW())
       ON CONFLICT (gateway) DO UPDATE SET mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      { replacements: { gateway, mode, actor: actor.id }, transaction }
    );
    await sequelize.query(
      `INSERT INTO gateway_mode_changes (gateway, from_mode, to_mode, note, changed_by) VALUES (:gateway, :from, :mode, :note, :actor)`,
      { replacements: { gateway, from, mode, note: String(note || '').trim().slice(0, 500) || null, actor: actor.id }, transaction }
    );
  });
  modes = { ...modes, [gateway]: mode };
  console.warn(`[Gateway mode] ${gateway} switched ${from} → ${mode} by user ${actor.id}`);
  return getSettings();
}

async function addTestAccount({ userId, actor }) {
  assertReady();
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new GatewayModeError(400, 'Choose a person.');
  const [users] = await sequelize.query('SELECT id FROM "Users" WHERE id = :id', { replacements: { id } });
  if (!users.length) throw new GatewayModeError(404, 'That person doesn’t exist.');
  await sequelize.query(
    'INSERT INTO payment_test_accounts (user_id, added_by) VALUES (:id, :actor) ON CONFLICT (user_id) DO NOTHING',
    { replacements: { id, actor: actor.id } }
  );
  testers = new Set([...testers, id]);
  return getSettings();
}

async function removeTestAccount({ userId }) {
  assertReady();
  const id = Number(userId);
  await sequelize.query('DELETE FROM payment_test_accounts WHERE user_id = :id', { replacements: { id } });
  const next = new Set(testers);
  next.delete(id);
  testers = next;
  return getSettings();
}

module.exports = {
  GATEWAYS,
  GatewayModeError,
  modeFor,
  secretKeyFor,
  webhookSecretFor,
  runFixed,
  runCheckout,
  isTestPayment,
  paystackWebhookMode,
  stripeWebhookMode,
  recordTestPayment,
  modeOfPayment,
  testReferences,
  start,
  getSettings,
  setMode,
  addTestAccount,
  removeTestAccount,
  isReady: () => ready,
};
