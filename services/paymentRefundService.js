/**
 * Payments and staff-issued refunds.
 *
 * A refund sends the whole payment back through the gateway that took it
 * (Paystack or Stripe), then reverses exactly what that payment put into
 * wallets — the creator's earnings and any coupon-partner or referral
 * commission — as read from the wallet ledger, so nothing is recomputed or
 * guessed. Access ends because the purchase is no longer 'completed'.
 *
 * Order of work, chosen so money is never lost or doubled:
 *   1. A refund row is written first. A unique index allows one live refund
 *      per payment, so double clicks and two staff at once can't refund twice.
 *   2. The gateway is asked to refund. If it says no, the row is marked failed
 *      and nothing else changes. If it doesn't answer, the row stays open and
 *      "Check again" repeats the request safely (see refundGatewayService).
 *   3. Once the gateway has accepted, wallets are debited, access is removed
 *      and the row is completed — all in one database transaction, so either
 *      everything happens or nothing does, and it can simply run again.
 *
 * Wallets never go below zero. If someone has already withdrawn their share,
 * what's left is taken and the rest is recorded as unrecovered, which staff
 * must accept before the refund starts.
 *
 * No timers: everything happens when staff act.
 */
const crypto = require('crypto');
const sequelize = require('../config/db');
const { isRefundsReady } = require('../utils/ensureRefunds');
const gateway = require('./refundGatewayService');

class RefundError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = ['purchase', 'freebie'];
const GATEWAYS = ['paystack', 'stripe'];

const assertReady = () => {
  if (!isRefundsReady()) throw new RefundError(503, 'Refunds are unavailable right now. Check the server logs.');
};

const query = (sql, replacements = {}, transaction) =>
  sequelize.query(sql, { replacements, transaction, type: sequelize.QueryTypes.SELECT });

const toCents = (amount) => Math.round(Number(amount) * 100);
const fromCents = (cents) => Math.round(Number(cents)) / 100;
const nameOf = (row) => [row?.firstname, row?.lastname].filter(Boolean).join(' ') || null;

// --- Reading payments -----------------------------------------------------------

/**
 * Every paid sale, from both places sales are recorded: purchases, and
 * freebie_access rows from the direct freebie checkout that have no purchase.
 */
const PAYMENTS_CTE = `
  WITH payments AS (
    SELECT 'purchase'::text AS source, p.id::text AS id, p.payment_reference AS reference,
           p.user_id AS buyer_id, p.content_type::text AS content_type, p.content_id::text AS content_id,
           p.amount, p.currency, p.payment_gateway::text AS gateway, p.payment_status::text AS status,
           p.created_at
      FROM purchases p
    UNION ALL
    SELECT 'freebie', fa.id::text, fa.purchase_reference, fa.user_id, 'freebie', fa.freebie_id::text,
           fa.amount_paid, fa.currency, CASE WHEN fa.currency = 'USD' THEN 'stripe' ELSE 'paystack' END,
           'completed', fa.created_at
      FROM freebie_access fa
     WHERE fa.purchase_reference IS NOT NULL AND fa.amount_paid > 0
       AND NOT EXISTS (SELECT 1 FROM purchases p2 WHERE p2.payment_reference = fa.purchase_reference)
  )`;

/** Title and owner of each sold item, in one query per type. */
async function describeContent(items, transaction) {
  const result = new Map();
  const ids = (type) => [...new Set(items.filter((i) => i.contentType === type && UUID.test(i.contentId || '')).map((i) => i.contentId))];
  const sources = [
    ['video', 'SELECT id::text AS id, title, user_id AS "ownerId" FROM videos WHERE id IN (:ids)'],
    ['live_class', 'SELECT id::text AS id, title, user_id AS "ownerId" FROM live_classes WHERE id IN (:ids)'],
    ['live_series', 'SELECT id::text AS id, title, user_id AS "ownerId" FROM live_series WHERE id IN (:ids)'],
    ['freebie', 'SELECT id::text AS id, title, user_id AS "ownerId" FROM freebies WHERE id IN (:ids)'],
    ['course', 'SELECT id::text AS id, name AS title, NULL::int AS "ownerId" FROM courses WHERE id IN (:ids)'],
  ];
  for (const [type, sql] of sources) {
    const list = ids(type);
    if (!list.length) continue;
    try {
      for (const row of await query(sql, { ids: list }, transaction)) result.set(`${type}:${row.id}`, row);
    } catch (error) {
      console.error(`[Refunds] Could not read ${type} titles:`, error.message);
    }
  }
  return result;
}

async function usersById(userIds, transaction) {
  const ids = [...new Set(userIds.filter((id) => Number.isInteger(Number(id))).map(Number))];
  if (!ids.length) return new Map();
  const rows = await query('SELECT id, firstname, lastname, email FROM "Users" WHERE id IN (:ids)', { ids }, transaction);
  return new Map(rows.map((r) => [Number(r.id), r]));
}

function shapePayment(row, content, buyer, refund) {
  return {
    source: row.source,
    id: row.id,
    reference: row.reference,
    buyer: { id: Number(row.buyer_id), name: nameOf(buyer), email: buyer?.email ?? null },
    content: { type: row.content_type, id: row.content_id, title: content?.title ?? null },
    amount: Number(row.amount),
    currency: row.currency,
    gateway: row.gateway,
    status: row.status,
    createdAt: row.created_at,
    refund: refund ? { id: refund.id, status: refund.status, createdAt: refund.created_at } : null,
  };
}

async function listPayments({ status, currency, search, page = 1, limit = 20 }) {
  const where = [];
  const replacements = {};
  if (['completed', 'refunded', 'pending', 'failed'].includes(status)) {
    where.push('pay.status = :status');
    replacements.status = status;
  }
  if (['NGN', 'USD'].includes(currency)) {
    where.push('pay.currency = :currency');
    replacements.currency = currency;
  }
  const term = String(search || '').trim().slice(0, 100);
  if (term) {
    where.push(`(pay.reference ILIKE :term OR u.email ILIKE :term
                 OR (COALESCE(u.firstname, '') || ' ' || COALESCE(u.lastname, '')) ILIKE :term)`);
    replacements.term = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const current = Math.max(Number(page) || 1, 1);

  const rows = await query(
    `${PAYMENTS_CTE}
     SELECT pay.*, COUNT(*) OVER() AS total
       FROM payments pay LEFT JOIN "Users" u ON u.id = pay.buyer_id
       ${filter}
      ORDER BY pay.created_at DESC
      LIMIT :limit OFFSET :offset`,
    { ...replacements, limit: size, offset: (current - 1) * size }
  );
  const total = rows.length ? Number(rows[0].total) : 0;

  const [contents, buyers, refunds] = await Promise.all([
    describeContent(rows.map((r) => ({ contentType: r.content_type, contentId: r.content_id }))),
    usersById(rows.map((r) => r.buyer_id)),
    rows.length && isRefundsReady()
      ? query(
          `SELECT DISTINCT ON (payment_reference) id, payment_reference, status, created_at
             FROM payment_refunds WHERE payment_reference IN (:refs)
            ORDER BY payment_reference, created_at DESC`,
          { refs: rows.map((r) => r.reference) }
        )
      : [],
  ]);
  const refundByRef = new Map(refunds.map((r) => [r.payment_reference, r]));

  const summaryRows = await query(
    `${PAYMENTS_CTE}
     SELECT currency, status, COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total
       FROM payments GROUP BY currency, status`
  );
  const summary = {};
  for (const row of summaryRows) {
    summary[row.currency] ??= {};
    summary[row.currency][row.status] = { count: row.count, total: Number(row.total) };
  }

  return {
    items: rows.map((r) =>
      shapePayment(r, contents.get(`${r.content_type}:${r.content_id}`), buyers.get(Number(r.buyer_id)), refundByRef.get(r.reference))
    ),
    pagination: { page: current, limit: size, total, totalPages: Math.ceil(total / size) },
    summary,
  };
}

async function loadPayment(source, id, transaction) {
  if (!SOURCES.includes(source) || !UUID.test(String(id))) throw new RefundError(404, 'Payment not found.');
  const sql =
    source === 'purchase'
      ? `SELECT 'purchase' AS source, p.id::text AS id, p.payment_reference AS reference, p.user_id AS buyer_id,
                p.content_type::text AS content_type, p.content_id::text AS content_id, p.amount, p.currency,
                p.payment_gateway::text AS gateway, p.payment_status::text AS status, p.created_at
           FROM purchases p WHERE p.id = :id`
      : `SELECT 'freebie' AS source, fa.id::text AS id, fa.purchase_reference AS reference, fa.user_id AS buyer_id,
                'freebie' AS content_type, fa.freebie_id::text AS content_id, fa.amount_paid AS amount, fa.currency,
                CASE WHEN fa.currency = 'USD' THEN 'stripe' ELSE 'paystack' END AS gateway,
                'completed' AS status, fa.created_at
           FROM freebie_access fa WHERE fa.id = :id`;
  const [row] = await query(sql, { id }, transaction);
  if (!row) throw new RefundError(404, 'Payment not found.');
  return row;
}

// --- What a payment put into wallets ------------------------------------------------

/**
 * Every wallet credit this payment caused, straight from the ledger:
 * the creator's earnings (reference = payment reference, or freebie_sale_<access id>),
 * a coupon partner's commission (PARTNER-<reference>), and a referral partner's
 * (REFERRAL-<purchase id>). Credits that also name the purchase in their
 * metadata are included, so nothing is missed if a reference differs.
 */
async function creditsFor(payment, transaction) {
  const refs = new Set();
  if (payment.reference) refs.add(payment.reference);
  if (payment.source === 'purchase') {
    refs.add(`PARTNER-${payment.reference}`);
    refs.add(`REFERRAL-${payment.id}`);
    if (payment.content_type === 'freebie') {
      const accesses = await query('SELECT id::text AS id FROM freebie_access WHERE purchase_reference = :ref', { ref: payment.reference }, transaction);
      for (const a of accesses) refs.add(`freebie_sale_${a.id}`);
    }
  } else {
    refs.add(`freebie_sale_${payment.id}`);
  }
  const byPurchase = payment.source === 'purchase' ? "OR ft.metadata->>'purchaseId' = :purchaseId" : '';
  return query(
    `SELECT ft.id::text AS id, ft.reference, ft.amount, ft.currency, ft.wallet_id::text AS "walletId", wa.user_id AS "userId"
       FROM financial_transactions ft
       JOIN wallet_accounts wa ON wa.id = ft.wallet_id
      WHERE ft.transaction_type = 'credit' AND ft.status = 'completed'
        AND (ft.reference IN (:refs) ${byPurchase})
      ORDER BY ft.created_at`,
    { refs: [...refs], purchaseId: payment.id },
    transaction
  );
}

function roleOf(credit, ownerId) {
  if (String(credit.reference).startsWith('PARTNER-')) return 'coupon_partner';
  if (String(credit.reference).startsWith('REFERRAL-')) return 'referral_partner';
  if (ownerId != null && Number(credit.userId) === Number(ownerId)) return 'creator';
  return 'earner';
}

// --- Preview -----------------------------------------------------------------------

function whyNotRefundable(payment, activeRefund) {
  if (activeRefund?.status === 'completed') return 'This payment was already refunded.';
  if (activeRefund?.status === 'processing') return 'A refund for this payment is in progress.';
  if (payment.status === 'refunded') return 'This payment was already refunded.';
  if (payment.status !== 'completed') return 'Only completed payments can be refunded.';
  if (!(Number(payment.amount) > 0)) return 'Free items have nothing to refund.';
  if (!GATEWAYS.includes(payment.gateway)) return 'This payment didn’t go through Paystack or Stripe.';
  if (!payment.reference) return 'This payment has no gateway reference.';
  return null;
}

async function activeRefundFor(reference, transaction) {
  const [row] = await query(
    `SELECT * FROM payment_refunds WHERE payment_reference = :ref AND status <> 'failed' ORDER BY created_at DESC LIMIT 1`,
    { ref: reference },
    transaction
  );
  return row ?? null;
}

async function preview({ source, id }) {
  assertReady();
  const payment = await loadPayment(source, id);
  const [contents, credits, active] = await Promise.all([
    describeContent([{ contentType: payment.content_type, contentId: payment.content_id }]),
    creditsFor(payment),
    activeRefundFor(payment.reference),
  ]);
  const content = contents.get(`${payment.content_type}:${payment.content_id}`);
  const people = await usersById([payment.buyer_id, ...credits.map((c) => c.userId)]);
  const wallets = credits.length
    ? await query('SELECT id::text AS id, balance_available FROM wallet_accounts WHERE id IN (:ids)', { ids: [...new Set(credits.map((c) => c.walletId))] })
    : [];
  const available = new Map(wallets.map((w) => [w.id, Number(w.balance_available)]));

  // Several credits can share a wallet: take from what's left after the earlier ones.
  const reversals = credits.map((credit) => {
    const cents = Number(credit.amount);
    const left = available.get(credit.walletId) ?? 0;
    const take = Math.max(0, Math.min(left, cents));
    available.set(credit.walletId, left - take);
    const person = people.get(Number(credit.userId));
    return {
      userId: Number(credit.userId),
      name: nameOf(person),
      email: person?.email ?? null,
      role: roleOf(credit, content?.ownerId),
      credited: fromCents(cents),
      recover: fromCents(take),
      shortfall: fromCents(cents - take),
    };
  });
  const sum = (key) => fromCents(reversals.reduce((total, r) => total + toCents(r[key]), 0));

  return {
    payment: shapePayment(payment, content, people.get(Number(payment.buyer_id)), active),
    blockedReason: whyNotRefundable(payment, active),
    reversals,
    totals: { credited: sum('credited'), recover: sum('recover'), shortfall: sum('shortfall') },
    keptByHallos: Math.max(0, fromCents(toCents(payment.amount) - toCents(sum('credited')))),
  };
}

// --- Refunding ------------------------------------------------------------------------

function shapeRefund(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    paymentReference: row.payment_reference,
    source: row.source,
    sourceId: row.source_id,
    buyerId: Number(row.buyer_id),
    contentType: row.content_type,
    contentId: row.content_id,
    amount: Number(row.amount),
    currency: row.currency,
    gateway: row.gateway,
    gatewayRefundId: row.gateway_refund_id,
    gatewayStatus: row.gateway_status,
    gatewayOutcome: row.gateway_status ? gateway.outcomeOf(row.gateway_status) : null,
    status: row.status,
    reason: row.reason,
    reversals: row.reversals || [],
    unrecovered: Number(row.unrecovered),
    failureMessage: row.failure_message,
    createdBy: Number(row.created_by),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    ...extra,
  };
}

const loadRefund = async (id, transaction) => {
  if (!UUID.test(String(id))) return null;
  const [row] = await query('SELECT * FROM payment_refunds WHERE id = :id', { id }, transaction);
  return row ?? null;
};

/** Step 2: ask the gateway. Returns true once the gateway has accepted the refund. */
async function sendToGateway(row) {
  if (row.gateway_status) return true;
  try {
    const result = await gateway.refund({
      gateway: row.gateway,
      reference: row.payment_reference,
      idempotencyKey: row.id,
      note: row.reason,
    });
    if (gateway.outcomeOf(result.status) === 'failed') {
      await sequelize.query(
        `UPDATE payment_refunds SET status = 'failed', gateway_refund_id = :gid, gateway_status = :gs,
                failure_message = :msg, updated_at = NOW() WHERE id = :id AND status = 'processing'`,
        { replacements: { id: row.id, gid: result.id, gs: result.status, msg: 'The gateway declined this refund.' } }
      );
      return false;
    }
    await sequelize.query(
      `UPDATE payment_refunds SET gateway_refund_id = :gid, gateway_status = :gs, failure_message = NULL, updated_at = NOW()
        WHERE id = :id AND status = 'processing'`,
      { replacements: { id: row.id, gid: result.id, gs: result.status } }
    );
    return true;
  } catch (error) {
    if (error instanceof gateway.GatewayRefundError && error.definite) {
      await sequelize.query(
        `UPDATE payment_refunds SET status = 'failed', failure_message = :msg, updated_at = NOW()
          WHERE id = :id AND status = 'processing'`,
        { replacements: { id: row.id, msg: error.message.slice(0, 1000) } }
      );
      return false;
    }
    // No answer: the refund may or may not have happened. Leave it open to check again.
    const message = error instanceof gateway.GatewayRefundError ? error.message : 'The gateway couldn’t be reached.';
    console.error('[Refunds] Gateway did not answer for refund', row.id, error.message);
    await sequelize.query(
      `UPDATE payment_refunds SET failure_message = :msg, updated_at = NOW() WHERE id = :id AND status = 'processing'`,
      { replacements: { id: row.id, msg: `${message} Use “Check again”; it’s safe and won’t refund twice.` } }
    );
    return false;
  }
}

/** Step 3: take back what the payment put into wallets and end access, all at once. */
async function settle(refundId) {
  const { WalletAccount, WalletTransaction } = sequelize.models;
  if (!WalletAccount || !WalletTransaction) throw new RefundError(503, 'Wallets are unavailable right now.');

  // Read the title outside the transaction: a failed read inside it would abort the whole thing.
  const before = await loadRefund(refundId);
  if (!before || before.status !== 'processing' || !before.gateway_status) return null;
  const contents = await describeContent([{ contentType: before.content_type, contentId: before.content_id }]);
  const content = contents.get(`${before.content_type}:${before.content_id}`);

  return sequelize.transaction(async (t) => {
    const [row] = await query('SELECT * FROM payment_refunds WHERE id = :id FOR UPDATE', { id: refundId }, t);
    if (!row || row.status !== 'processing' || !row.gateway_status) return null;

    const payment = await loadPayment(row.source, row.source_id, t);
    const credits = await creditsFor(payment, t);
    const tag = row.id.replace(/-/g, '');

    const reversals = [];
    let unrecoveredCents = 0;
    for (const [index, credit] of credits.entries()) {
      const cents = Number(credit.amount);
      const wallet = await WalletAccount.findOne({ where: { id: credit.walletId }, lock: t.LOCK.UPDATE, transaction: t });
      const available = wallet ? Number(wallet.balance_available) : 0;
      const take = Math.max(0, Math.min(available, cents));
      if (take > 0) {
        await wallet.update({ balance_available: available - take }, { transaction: t });
        await WalletTransaction.create(
          {
            wallet_account_id: wallet.id,
            transaction_type: 'debit',
            amount: take,
            currency: credit.currency,
            reference: `RFD-${tag}-${index + 1}`, // ≤ 50 characters
            description: `Refund of a sale${content?.title ? `: ${String(content.title).slice(0, 150)}` : ''}`,
            metadata: {
              refundId: row.id,
              reversesReference: credit.reference,
              paymentReference: row.payment_reference,
              buyerUserId: Number(row.buyer_id),
              contentType: row.content_type,
              contentId: row.content_id,
              currency: credit.currency,
            },
            status: 'completed',
            idempotency_key: crypto.randomUUID(),
            completed_at: new Date(),
          },
          { transaction: t }
        );
      }
      unrecoveredCents += cents - take;
      reversals.push({
        userId: Number(credit.userId),
        role: roleOf(credit, content?.ownerId),
        reference: credit.reference,
        credited: fromCents(cents),
        recovered: fromCents(take),
        shortfall: fromCents(cents - take),
      });
    }

    // End access. Access checks only accept completed purchases.
    if (payment.source === 'purchase') {
      await sequelize.query(
        `UPDATE purchases SET payment_status = 'refunded', updated_at = NOW() WHERE id = :id AND payment_status = 'completed'`,
        { replacements: { id: payment.id }, transaction: t }
      );
      if (payment.content_type === 'freebie') {
        await sequelize.query('DELETE FROM freebie_access WHERE purchase_reference = :ref', { replacements: { ref: payment.reference }, transaction: t });
      }
      if (payment.content_type === 'course') {
        const [{ exists }] = await query("SELECT to_regclass('course_enrollments') IS NOT NULL AS exists", {}, t);
        if (exists) {
          await sequelize.query(
            `UPDATE course_enrollments SET expires_at = NOW()
              WHERE purchase_id = :id AND (expires_at IS NULL OR expires_at > NOW())`,
            { replacements: { id: payment.id }, transaction: t }
          );
        }
      }
    } else {
      await sequelize.query('DELETE FROM freebie_access WHERE id = :id', { replacements: { id: payment.id }, transaction: t });
    }

    await sequelize.query(
      `UPDATE payment_refunds
          SET status = 'completed', reversals = CAST(:reversals AS jsonb), unrecovered = :unrecovered,
              failure_message = NULL, completed_at = NOW(), updated_at = NOW()
        WHERE id = :id`,
      { replacements: { id: row.id, reversals: JSON.stringify(reversals), unrecovered: fromCents(unrecoveredCents) }, transaction: t }
    );
    return { row, reversals, content };
  });
}

/** Best effort, after everything is saved: tell the buyer and the creator. */
function notify(settled) {
  if (!settled) return;
  const { row, reversals, content } = settled;
  (async () => {
    const { sendRefundIssuedEmail, sendSaleRefundedEmail } = require('../utils/email');
    const creatorShare = reversals.filter((r) => r.role === 'creator');
    const people = await usersById([row.buyer_id, ...creatorShare.map((r) => r.userId)]);
    const buyer = people.get(Number(row.buyer_id));
    if (buyer?.email) {
      await sendRefundIssuedEmail(buyer.email, buyer.firstname, content?.title, Number(row.amount), row.currency).catch((e) =>
        console.error('[Refunds] Buyer email failed:', e.message)
      );
    }
    for (const share of creatorShare) {
      const creator = people.get(share.userId);
      if (creator?.email && share.recovered > 0) {
        await sendSaleRefundedEmail(creator.email, creator.firstname, content?.title, share.recovered, row.currency).catch((e) =>
          console.error('[Refunds] Creator email failed:', e.message)
        );
      }
    }
  })().catch((error) => console.error('[Refunds] Notification failed:', error.message));
}

/** Move an open refund as far as it can go right now. */
async function advance(refundId) {
  const row = await loadRefund(refundId);
  if (!row || row.status !== 'processing') return row;
  const accepted = await sendToGateway(row);
  if (accepted) {
    try {
      notify(await settle(row.id));
    } catch (error) {
      // The gateway already refunded; the books can be finished with "Check again".
      console.error('[Refunds] Settling refund failed for', row.id, error);
      await sequelize.query(
        `UPDATE payment_refunds SET failure_message = :msg, updated_at = NOW() WHERE id = :id AND status = 'processing'`,
        { replacements: { id: row.id, msg: 'The buyer was refunded, but wallets weren’t updated yet. Use “Check again” to finish.' } }
      );
    }
  }
  return loadRefund(row.id);
}

async function refund({ source, id, reason, acceptShortfall, actor }) {
  assertReady();
  const note = String(reason || '').trim();
  if (note.length < 5) throw new RefundError(400, 'Say why you’re refunding (at least 5 characters).');

  const check = await preview({ source, id });
  if (check.blockedReason) throw new RefundError(409, check.blockedReason);
  if (check.totals.shortfall > 0 && acceptShortfall !== true) {
    throw new RefundError(409, 'Some earnings were already withdrawn. Confirm that Hallos covers the difference.', 'SHORTFALL_NOT_ACCEPTED');
  }

  const payment = check.payment;
  let row;
  try {
    [row] = await query(
      `INSERT INTO payment_refunds
         (payment_reference, source, source_id, buyer_id, content_type, content_id, amount, currency, gateway, reason, created_by)
       VALUES (:reference, :source, :sourceId, :buyerId, :contentType, :contentId, :amount, :currency, :gateway, :reason, :actorId)
       RETURNING *`,
      {
        reference: payment.reference,
        source: payment.source,
        sourceId: payment.id,
        buyerId: payment.buyer.id,
        contentType: payment.content.type,
        contentId: payment.content.id,
        amount: payment.amount,
        currency: payment.currency,
        gateway: payment.gateway,
        reason: note.slice(0, 1000),
        actorId: actor.id,
      }
    );
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505') {
      throw new RefundError(409, 'This payment is already being refunded.');
    }
    throw error;
  }
  return shapeRefund(await advance(row.id));
}

/** "Check again": finish an open refund, or refresh the gateway's status of a finished one. */
async function recheck(refundId) {
  assertReady();
  let row = await loadRefund(refundId);
  if (!row) throw new RefundError(404, 'Refund not found.');
  if (row.status === 'processing') {
    row = await advance(row.id);
  } else if (row.status === 'completed' && row.gateway_refund_id && gateway.outcomeOf(row.gateway_status) === 'pending') {
    try {
      const status = await gateway.refundStatus({ gateway: row.gateway, refundId: row.gateway_refund_id });
      await sequelize.query('UPDATE payment_refunds SET gateway_status = :status, updated_at = NOW() WHERE id = :id', {
        replacements: { id: row.id, status },
      });
      row = await loadRefund(row.id);
    } catch (error) {
      throw new RefundError(502, error.message || 'Couldn’t reach the gateway. Try again shortly.');
    }
  }
  return shapeRefund(row);
}

async function listRefunds({ status, page = 1, limit = 20 }) {
  assertReady();
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const filter = ['processing', 'completed', 'failed'].includes(status) ? 'WHERE r.status = :status' : '';
  const rows = await query(
    `SELECT r.*, COUNT(*) OVER() AS total FROM payment_refunds r ${filter}
      ORDER BY r.created_at DESC LIMIT :limit OFFSET :offset`,
    { status, limit: size, offset: (current - 1) * size }
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  const people = await usersById(rows.flatMap((r) => [r.buyer_id, r.created_by, ...(r.reversals || []).map((x) => x.userId)]));
  const contents = await describeContent(rows.map((r) => ({ contentType: r.content_type, contentId: r.content_id })));
  return {
    items: rows.map((r) =>
      shapeRefund(r, {
        buyer: { id: Number(r.buyer_id), name: nameOf(people.get(Number(r.buyer_id))), email: people.get(Number(r.buyer_id))?.email ?? null },
        staffName: nameOf(people.get(Number(r.created_by))),
        contentTitle: contents.get(`${r.content_type}:${r.content_id}`)?.title ?? null,
        reversals: (r.reversals || []).map((x) => ({ ...x, name: nameOf(people.get(Number(x.userId))) })),
      })
    ),
    pagination: { page: current, limit: size, total, totalPages: Math.ceil(total / size) },
    openCount: (await query("SELECT COUNT(*)::int AS n FROM payment_refunds WHERE status = 'processing'"))[0].n,
  };
}

module.exports = { listPayments, preview, refund, recheck, listRefunds, RefundError };
