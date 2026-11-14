/**
 * Stuck payments: money that reached Paystack or Stripe but never became a
 * purchase, wallet top-up or campaign registration on Hallos (a webhook that
 * never arrived, a buyer who closed the tab before the return page, a crash).
 *
 * Scanning happens only when a super admin opens the list — no background
 * job — and asks the gateways for successful payments in a recent window,
 * then checks each one against our records. Results are cached for a minute
 * so repeated views don't hammer the gateways.
 *
 * Settling re-verifies the payment with the gateway first (never trusting the
 * list), then runs the platform's own code for that kind of payment, the
 * same steps the webhook takes:
 *   - purchase: paymentRoutingService.processSuccessfulPayment (purchase,
 *     access, creator and commission credits; test payments credit nobody),
 *     plus the course enrolment for course purchases;
 *   - top-up: credit the wallet under the top-up's own reference, so the
 *     ledger's unique reference makes a second credit impossible;
 *   - campaign registration: mark it paid and send the quiz access email.
 * Every step is safe to repeat: anything already recorded is left alone.
 *
 * Always uses the live keys (this runs outside any checkout), so only real
 * payments are scanned.
 */
const crypto = require('crypto');
const sequelize = require('../config/db');
const { paystackClient } = require('../config/paystack');
const { stripeClient } = require('../config/stripe');

class StuckPaymentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const WINDOWS = [7, 30, 90];
const MAX_PER_GATEWAY = 2000;
const CACHE_MS = 60 * 1000;
const cache = new Map();

const select = (sql, replacements = {}, transaction) =>
  sequelize.query(sql, { replacements, transaction, type: sequelize.QueryTypes.SELECT });

const parseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const kindOf = (metadata) => {
  if (metadata.type === 'wallet_topup') return 'topup';
  if (metadata.type === 'campaign_registration') return 'campaign';
  if (metadata.contentType) return 'purchase';
  return null; // not something Hallos checkout created
};

// --- Reading the gateways --------------------------------------------------------

async function paystackPayments(since) {
  const out = [];
  for (let page = 1; out.length < MAX_PER_GATEWAY; page += 1) {
    const { data } = await paystackClient.get('/transaction', {
      params: { status: 'success', from: since.toISOString(), perPage: 100, page },
      timeout: 20000,
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    for (const t of rows) {
      if (String(t.domain || 'live') === 'test') continue;
      const metadata = parseMetadata(t.metadata);
      out.push({
        gateway: 'paystack',
        reference: t.reference,
        amount: Number(t.amount) / 100,
        currency: String(t.currency || 'NGN').toUpperCase(),
        paidAt: t.paid_at || t.paidAt || t.created_at || t.createdAt,
        email: t.customer?.email ?? null,
        metadata,
        kind: kindOf(metadata),
      });
    }
    const pageCount = Number(data?.meta?.pageCount || 0);
    if (rows.length < 100 || (pageCount && page >= pageCount)) break;
  }
  return out;
}

async function stripePayments(since) {
  const out = [];
  let startingAfter;
  while (out.length < MAX_PER_GATEWAY) {
    const page = await stripeClient.checkout.sessions.list({
      limit: 100,
      status: 'complete',
      created: { gte: Math.floor(since.getTime() / 1000) },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const s of page.data || []) {
      if (s.livemode === false || s.payment_status !== 'paid') continue;
      const metadata = s.metadata || {};
      out.push({
        gateway: 'stripe',
        reference: s.id,
        topUpReference: metadata.reference || null,
        amount: Number(s.amount_total) / 100,
        currency: String(s.currency || 'usd').toUpperCase(),
        paidAt: new Date(Number(s.created) * 1000).toISOString(),
        email: s.customer_details?.email ?? null,
        metadata,
        kind: kindOf(metadata),
      });
    }
    if (!page.has_more || !page.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

// --- Matching against our records ------------------------------------------------------

async function recorded(payments) {
  const refs = [...new Set(payments.flatMap((p) => [p.reference, p.topUpReference].filter(Boolean)))];
  if (!refs.length) return new Set();
  const found = new Set();
  const add = (rows, key) => rows.forEach((r) => found.add(r[key]));
  add(await select('SELECT payment_reference AS ref FROM purchases WHERE payment_reference IN (:refs)', { refs }), 'ref');
  add(await select('SELECT purchase_reference AS ref FROM freebie_access WHERE purchase_reference IN (:refs)', { refs }), 'ref');
  add(await select("SELECT reference AS ref FROM financial_transactions WHERE transaction_type = 'credit' AND reference IN (:refs)", { refs }), 'ref');
  try {
    add(await select("SELECT payment_reference AS ref FROM campaign_registrations WHERE payment_status = 'completed' AND payment_reference IN (:refs)", { refs }), 'ref');
  } catch {
    // no campaign registrations table: nothing to match
  }
  return found;
}

const isRecorded = (payment, found) => found.has(payment.reference) || (payment.topUpReference && found.has(payment.topUpReference));

async function describe(items) {
  const userIds = [...new Set(items.map((i) => Number(i.metadata.userId)).filter(Number.isInteger))];
  const users = userIds.length
    ? new Map((await select('SELECT id, firstname, lastname, email FROM "Users" WHERE id IN (:ids)', { ids: userIds })).map((u) => [Number(u.id), u]))
    : new Map();
  const titles = new Map();
  const byType = { video: 'videos', live_class: 'live_classes', live_series: 'live_series', freebie: 'freebies', course: 'courses' };
  for (const [type, table] of Object.entries(byType)) {
    const ids = [...new Set(items.filter((i) => i.metadata.contentType === type).map((i) => String(i.metadata.contentId)).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!ids.length) continue;
    const column = type === 'course' ? 'name' : 'title';
    for (const row of await select(`SELECT id::text AS id, ${column} AS title FROM ${table} WHERE id IN (:ids)`, { ids })) titles.set(`${type}:${row.id}`, row.title);
  }
  return items.map((item) => {
    const user = users.get(Number(item.metadata.userId));
    const label =
      item.kind === 'topup' ? 'Wallet top-up' : item.kind === 'campaign' ? 'Campaign registration' : titles.get(`${item.metadata.contentType}:${item.metadata.contentId}`) ?? null;
    return {
      gateway: item.gateway,
      reference: item.reference,
      kind: item.kind,
      contentType: item.metadata.contentType ?? null,
      title: label,
      amount: item.amount,
      currency: item.currency,
      paidAt: item.paidAt,
      buyer: user
        ? { id: Number(user.id), name: [user.firstname, user.lastname].filter(Boolean).join(' ') || null, email: user.email }
        : { id: Number(item.metadata.userId) || null, name: null, email: item.email },
    };
  });
}

async function listStuck({ days = 30, refresh = false } = {}) {
  const window = WINDOWS.includes(Number(days)) ? Number(days) : 30;
  const cached = cache.get(window);
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  const since = new Date(Date.now() - window * 86400000);
  const errors = [];
  const fetchSafely = async (name, fn) => {
    try {
      return await fn(since);
    } catch (error) {
      console.error(`[Stuck payments] Could not read ${name}:`, error.response?.data?.message || error.message);
      errors.push(`${name} couldn’t be reached. Try again shortly.`);
      return [];
    }
  };
  const [paystack, stripe] = await Promise.all([fetchSafely('Paystack', paystackPayments), fetchSafely('Stripe', stripePayments)]);
  const ours = [...paystack, ...stripe].filter((p) => p.kind);
  const found = await recorded(ours);
  const stuck = ours.filter((p) => !isRecorded(p, found)).sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));

  const result = {
    days: window,
    scanned: { paystack: paystack.length, stripe: stripe.length },
    items: await describe(stuck),
    errors,
    checkedAt: new Date().toISOString(),
  };
  cache.set(window, { at: Date.now(), result });
  return result;
}

// --- Settling -------------------------------------------------------------------------

/** Fresh, authoritative copy of the payment from the gateway. */
async function verify(gateway, reference) {
  const PaymentRoutingService = require('./paymentRoutingService');
  const routing = new PaymentRoutingService();
  const result = gateway === 'paystack' ? await routing.verifyPaystackPayment(reference) : await routing.verifyStripePayment(reference);
  if (!result?.success || !result.data) throw new StuckPaymentError(409, result?.message || 'The gateway says this payment didn’t go through.');
  const data = result.data;
  if (gateway === 'paystack' && String(data.domain || 'live') === 'test') throw new StuckPaymentError(409, 'That was a test payment.');
  if (gateway === 'stripe' && data.livemode === false) throw new StuckPaymentError(409, 'That was a test payment.');
  return { routing, data, metadata: parseMetadata(data.metadata) };
}

async function settlePurchase({ gateway, reference, routing, data, metadata }) {
  const currency = String(data.currency || (gateway === 'stripe' ? 'usd' : 'ngn')).toUpperCase();
  const result = await routing.processSuccessfulPayment({ paymentData: data, currency, gateway, reference });
  const purchase = result.purchase;

  if (!result.alreadyProcessed && metadata.contentType === 'course' && purchase) {
    const CourseEnrollmentService = require('./courseEnrollmentService');
    const customer = data.customer || {};
    const accessType = metadata.accessType || 'individual';
    await new CourseEnrollmentService().createEnrollment({
      userId: Number(metadata.userId),
      courseId: accessType === 'individual' ? metadata.contentId : null,
      purchaseId: purchase.id,
      studentName: metadata.studentName || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || data.customer_details?.name || 'N/A',
      studentEmail: metadata.studentEmail || customer.email || data.customer_details?.email || metadata.email || 'N/A',
      studentPhone: metadata.studentPhone || 'N/A',
      accessType,
      expiresAt: metadata.expiresAt ? new Date(metadata.expiresAt) : null,
    });
  }

  if (!result.alreadyProcessed && purchase) {
    try {
      const Transaction = require('../models/Transaction');
      await Transaction.create({
        userId: Number(metadata.userId),
        transactionType: 'purchase',
        amount: Number(purchase.amount),
        currency,
        referenceType: 'purchase',
        referenceId: purchase.id,
        description: `Purchase of ${metadata.contentType} via ${gateway === 'stripe' ? 'Stripe' : 'Paystack'} (settled by staff)`,
        metadata: { reference, gateway, settledByStaff: true },
      });
    } catch (error) {
      console.error('[Stuck payments] Could not log the purchase transaction:', error.message);
    }
  }
  return { settled: !result.alreadyProcessed, already: Boolean(result.alreadyProcessed), purchaseId: purchase?.id ?? null };
}

async function settleTopUp({ gateway, reference, data, metadata, actor }) {
  const { WalletAccount, WalletTransaction } = sequelize.models;
  if (!WalletAccount || !WalletTransaction) throw new StuckPaymentError(503, 'Wallets are unavailable right now.');
  const transactionService = require('./databaseTransactionService');
  const ledgerReference = gateway === 'stripe' ? metadata.reference || reference : reference;
  const userId = Number(metadata.userId);
  if (!Number.isInteger(userId)) throw new StuckPaymentError(409, 'This top-up doesn’t say whose wallet it was for.');
  const currency = String(data.currency || (gateway === 'stripe' ? 'usd' : 'ngn')).toUpperCase();
  const cents = gateway === 'stripe' ? Number(data.amount_total) : Number(data.amount);
  if (!(cents > 0)) throw new StuckPaymentError(409, 'This top-up has no amount.');

  return sequelize.transaction(async (t) => {
    const existing = await select(
      "SELECT 1 FROM financial_transactions WHERE transaction_type = 'credit' AND reference IN (:refs)",
      { refs: [...new Set([ledgerReference, reference])] },
      t
    );
    if (existing.length) return { settled: false, already: true };
    let wallet = await WalletAccount.findOne({ where: { user_id: userId, currency }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) wallet = await transactionService.createWalletInTransaction(userId, currency, t);
    await wallet.update({ balance_available: Number(wallet.balance_available) + cents }, { transaction: t });
    await WalletTransaction.create(
      {
        wallet_account_id: wallet.id,
        transaction_type: 'credit',
        amount: cents,
        currency,
        reference: ledgerReference, // same reference the normal flows use: a second credit is impossible
        description: `Wallet top-up via ${gateway === 'stripe' ? 'Stripe' : 'Paystack'} (settled by staff)`,
        metadata: { gateway, type: 'topup', externalReference: reference, settledByStaff: actor.id, currency },
        status: 'completed',
        gateway,
        idempotency_key: crypto.randomUUID(),
        completed_at: new Date(),
      },
      { transaction: t }
    );
    return { settled: true, already: false, amount: cents / 100, currency };
  });
}

async function settleCampaign({ reference }) {
  const CampaignRegistration = require('../models/CampaignRegistration');
  const registration = await CampaignRegistration.findOne({ where: { paymentReference: reference } });
  if (!registration) throw new StuckPaymentError(404, 'No campaign registration uses this payment.');
  if (registration.paymentStatus === 'completed') return { settled: false, already: true };
  await registration.update({ paymentStatus: 'completed' });
  if (!registration.emailSent) {
    try {
      const { createQuizSession } = require('./campaignQuizService');
      const { sendCampaignQuizAccessEmail } = require('../utils/email');
      const { token } = await createQuizSession(registration.id, registration.email);
      await sendCampaignQuizAccessEmail(registration.email, registration.firstName, {
        lastName: registration.lastName,
        talent: registration.talent,
        location: registration.location,
        token,
      });
      await registration.update({ emailSent: true });
    } catch (error) {
      console.error('[Stuck payments] Campaign access email failed:', error.message);
    }
  }
  return { settled: true, already: false };
}

async function settle({ gateway, reference, actor }) {
  if (!['paystack', 'stripe'].includes(gateway)) throw new StuckPaymentError(400, 'Unknown payment gateway.');
  const ref = String(reference || '').trim();
  if (!ref || ref.length > 255) throw new StuckPaymentError(400, 'Missing payment reference.');

  let verified;
  try {
    verified = await verify(gateway, ref);
  } catch (error) {
    if (error instanceof StuckPaymentError) throw error;
    throw new StuckPaymentError(502, 'Couldn’t confirm this payment with the gateway. Try again shortly.');
  }
  const kind = kindOf(verified.metadata);
  if (!kind) throw new StuckPaymentError(409, 'This payment wasn’t made through a Hallos checkout.');

  const context = { gateway, reference: ref, actor, ...verified };
  let outcome;
  try {
    outcome = kind === 'purchase' ? await settlePurchase(context) : kind === 'topup' ? await settleTopUp(context) : await settleCampaign(context);
  } catch (error) {
    // Someone recorded it a moment earlier (a second click, the webhook, the
    // buyer's return page): the unique reference stopped a duplicate.
    const duplicate = error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505' || error.original?.code === '23505';
    if (!duplicate) throw error;
    outcome = { settled: false, already: true };
  }
  cache.clear();
  console.log(`[Stuck payments] ${actor.id} settled ${gateway} ${ref} (${kind}):`, outcome);
  return { kind, ...outcome };
}

module.exports = { listStuck, settle, StuckPaymentError };
