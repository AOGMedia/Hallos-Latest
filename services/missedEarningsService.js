/**
 * Creator earnings that never reached the wallet ledger.
 *
 * Until utils/ensureLedgerReferences.js widened it, the ledger's reference
 * column held 50 characters. Stripe sales are recorded under their Checkout
 * Session id (~66), so the creator credit for each of them failed silently and
 * the balance change rolled back. This finds exactly those sales and lets a
 * super admin credit them, once, after reviewing the list.
 *
 * What counts as missed (all must hold):
 *   - the purchase is completed (refunded sales are left alone),
 *   - its payment reference is longer than 50 characters — the failure's
 *     signature, so older sales paid some other way are never picked up,
 *   - the item has a creator (videos, live classes, series, freebies),
 *   - no credit for it exists: not under the payment reference, not as a late
 *     credit (LATE-<purchase id>), not tagged with the purchase in the
 *     creator's wallet, and no freebie_sale_ credit for the same payment.
 *
 * The amount is what the platform would have credited: the price paid minus
 * any referral or coupon-partner commission that was paid out for the sale.
 * Each credit uses the reference LATE-<purchase id>; the ledger's unique
 * reference makes paying the same sale twice impossible, even if two staff
 * click at once.
 */
const crypto = require('crypto');
const sequelize = require('../config/db');

class MissedEarningsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lateReference = (purchaseId) => `LATE-${purchaseId}`; // 41 characters

const select = (sql, replacements = {}, transaction) =>
  sequelize.query(sql, { replacements, transaction, type: sequelize.QueryTypes.SELECT });

/** Purchases whose creator was never credited, with what they are owed (in minor units). */
const MISSED_SQL = (onlyIds) => `
  WITH owners AS (
    SELECT p.id, p.user_id AS buyer_id, p.content_type::text AS content_type, p.content_id::text AS content_id,
           p.amount, p.currency, p.payment_gateway::text AS gateway, p.payment_reference AS reference, p.created_at,
           COALESCE(v.user_id, lc.user_id, ls.user_id, f.user_id) AS creator_id,
           COALESCE(v.title, lc.title, ls.title, f.title) AS title
      FROM purchases p
      LEFT JOIN videos v ON p.content_type::text = 'video' AND v.id = p.content_id
      LEFT JOIN live_classes lc ON p.content_type::text = 'live_class' AND lc.id = p.content_id
      LEFT JOIN live_series ls ON p.content_type::text = 'live_series' AND ls.id = p.content_id
      LEFT JOIN freebies f ON p.content_type::text = 'freebie' AND f.id = p.content_id
     WHERE p.payment_status::text = 'completed'
       AND LENGTH(p.payment_reference) > 50
       ${onlyIds ? 'AND p.id IN (:ids)' : ''}
  )
  SELECT o.*,
         COALESCE((SELECT SUM(ft.amount) FROM financial_transactions ft
                    WHERE ft.transaction_type = 'credit' AND ft.status = 'completed'
                      AND ft.reference IN ('REFERRAL-' || o.id::text, 'PARTNER-' || o.reference)), 0) AS commissions
    FROM owners o
   WHERE o.creator_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM financial_transactions ft
         JOIN wallet_accounts wa ON wa.id = ft.wallet_id
        WHERE ft.transaction_type = 'credit'
          AND (ft.reference IN (o.reference, 'LATE-' || o.id::text)
               OR (wa.user_id = o.creator_id AND ft.metadata->>'purchaseId' = o.id::text)))
     AND NOT EXISTS (
       SELECT 1 FROM freebie_access fa
         JOIN financial_transactions ft ON ft.reference = 'freebie_sale_' || fa.id::text
        WHERE fa.purchase_reference = o.reference)
   ORDER BY o.created_at`;

const owedCents = (row) => Math.max(0, Math.round(Number(row.amount) * 100) - Number(row.commissions));

async function namesFor(userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return new Map();
  const rows = await select('SELECT id, firstname, lastname, email FROM "Users" WHERE id IN (:ids)', { ids });
  return new Map(rows.map((r) => [Number(r.id), { name: [r.firstname, r.lastname].filter(Boolean).join(' ') || null, email: r.email }]));
}

async function listMissed() {
  const rows = await select(MISSED_SQL(false));
  const people = await namesFor(rows.flatMap((r) => [r.creator_id, r.buyer_id]));
  const items = rows
    .map((r) => ({
      purchaseId: r.id,
      reference: r.reference,
      contentType: r.content_type,
      contentId: r.content_id,
      title: r.title,
      creator: { id: Number(r.creator_id), ...(people.get(Number(r.creator_id)) ?? { name: null, email: null }) },
      buyer: { id: Number(r.buyer_id), ...(people.get(Number(r.buyer_id)) ?? { name: null, email: null }) },
      paid: Number(r.amount),
      commissions: Number(r.commissions) / 100,
      owed: owedCents(r) / 100,
      currency: r.currency,
      gateway: r.gateway,
      createdAt: r.created_at,
    }))
    .filter((item) => item.owed > 0);
  const totals = {};
  for (const item of items) {
    totals[item.currency] ??= { count: 0, owed: 0 };
    totals[item.currency].count += 1;
    totals[item.currency].owed = Math.round((totals[item.currency].owed + item.owed) * 100) / 100;
  }
  return { items, totals };
}

/** Credit one missed sale. Re-checks inside a locked transaction, so it is safe to run twice. */
async function creditOne(purchaseId, actor) {
  const { WalletAccount, WalletTransaction } = sequelize.models;
  if (!WalletAccount || !WalletTransaction) throw new MissedEarningsError(503, 'Wallets are unavailable right now.');
  const transactionService = require('./databaseTransactionService');

  return sequelize.transaction(async (t) => {
    await select('SELECT id FROM purchases WHERE id = :id FOR UPDATE', { id: purchaseId }, t);
    const [row] = await select(MISSED_SQL(true), { ids: [purchaseId] }, t);
    if (!row) return { purchaseId, credited: false, reason: 'Already credited or no longer eligible.' };
    const cents = owedCents(row);
    if (cents <= 0) return { purchaseId, credited: false, reason: 'Nothing owed after commissions.' };

    let wallet = await WalletAccount.findOne({ where: { user_id: row.creator_id, currency: row.currency }, lock: t.LOCK.UPDATE, transaction: t });
    if (!wallet) wallet = await transactionService.createWalletInTransaction(row.creator_id, row.currency, t);
    await wallet.update({ balance_available: Number(wallet.balance_available) + cents }, { transaction: t });
    await WalletTransaction.create(
      {
        wallet_account_id: wallet.id,
        transaction_type: 'credit',
        amount: cents,
        currency: row.currency,
        reference: lateReference(row.id),
        description: `Earnings from ${row.content_type} purchase (credited late)`,
        metadata: {
          purchaseId: row.id,
          buyerUserId: Number(row.buyer_id),
          contentType: row.content_type,
          contentId: row.content_id,
          gateway: row.gateway,
          originalReference: row.reference,
          lateCredit: true,
          creditedBy: actor.id,
          currency: row.currency,
        },
        status: 'completed',
        idempotency_key: crypto.randomUUID(),
        completed_at: new Date(),
      },
      { transaction: t }
    );
    return { purchaseId, credited: true, amount: cents / 100, currency: row.currency, creatorId: Number(row.creator_id) };
  });
}

async function creditMissed({ purchaseIds, actor }) {
  const ids = [...new Set((Array.isArray(purchaseIds) ? purchaseIds : []).map(String))];
  if (!ids.length) throw new MissedEarningsError(400, 'Choose at least one sale to credit.');
  if (ids.length > 500) throw new MissedEarningsError(400, 'Credit at most 500 sales at a time.');
  if (ids.some((id) => !UUID.test(id))) throw new MissedEarningsError(400, 'Some of those sales don’t exist.');

  const results = [];
  for (const id of ids) {
    try {
      results.push(await creditOne(id, actor));
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505') {
        results.push({ purchaseId: id, credited: false, reason: 'Already credited.' });
      } else {
        console.error('[Missed earnings] Credit failed for purchase', id, error);
        results.push({ purchaseId: id, credited: false, reason: 'Couldn’t credit this one. Try again.' });
      }
    }
  }
  const credited = results.filter((r) => r.credited);
  const totals = {};
  for (const r of credited) totals[r.currency] = Math.round(((totals[r.currency] ?? 0) + r.amount) * 100) / 100;
  console.log(`[Missed earnings] ${actor.id} credited ${credited.length} of ${ids.length} sales`, totals);
  return { results, credited: credited.length, skipped: results.length - credited.length, totals };
}

module.exports = { listMissed, creditMissed, MissedEarningsError };
