/**
 * One-off data-integrity backfill: every 'match_wager'/'match_win'/'match_refund'
 * ChutaCoinTransaction row was found storing `amount: 0` regardless of the real
 * wager/winnings/refund, while `balanceAfter` (computed correctly at write time
 * from currentBalance + realAmount) was NOT affected. escrowFunds/releaseEscrow/
 * refundEscrow in quizWalletService.js are verified correct in the current code
 * (they store the same `amount` variable used to compute balanceAfter) — this
 * is historical data corruption from an earlier, already-superseded version of
 * that code, not a live bug. getBalance() sums `amount` (deliberately, per its
 * own doc comment, as the single source of truth for CURRENT balance) — so
 * every affected row silently drops out of every balance calculation, which is
 * how users ended up with impossible negative computed balances after a
 * withdrawal that looked valid against a wrong (too-high) balance at the time.
 *
 * Reconstructs the true historical amount per user by walking their
 * transactions in chronological order and taking the delta between each row's
 * `balanceAfter` and the running balance implied by the prior row — since
 * balanceAfter was always computed correctly, this recovers the real amount
 * even though it wasn't stored correctly. Only rewrites a row when the
 * reconstructed amount actually differs from what's stored (so a genuinely
 * legitimate $0-wager friendly match is left untouched).
 *
 * Usage: node scripts/backfillChutaTransactionAmounts.js [--dry-run]
 */

const sequelize = require('../config/db');
const { Op } = require('sequelize');
const ChutaCoinTransaction = require('../models/ChutaCoinTransaction');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await sequelize.authenticate();
  console.log(`[Backfill] DB connection OK${dryRun ? ' (dry run — no writes)' : ''}`);

  const userIds = await ChutaCoinTransaction.findAll({
    attributes: [[sequelize.fn('DISTINCT', sequelize.col('user_id')), 'userId']],
    where: { type: { [Op.in]: ['match_wager', 'match_win', 'match_refund'] } },
    raw: true
  });
  console.log(`[Backfill] ${userIds.length} user(s) have match_wager/match_win/match_refund transactions to check.`);

  let usersChanged = 0;
  let rowsChanged = 0;
  let negativeBefore = 0;
  let negativeAfter = 0;

  // Only these three types are confirmed, by direct code review, to have a
  // single write site that is correct in the CURRENT code (escrowFunds /
  // releaseEscrow / refundEscrow in quizWalletService.js) — so a 0-amount row
  // of one of these types is unambiguously historical corruption to repair.
  // Every other type (tournament_entry, tournament_refund, purchase,
  // withdrawal, initial_bonus, admin_adjustment, ...) is left completely
  // alone even if the balanceAfter arithmetic *looks* like it doesn't add up
  // for that row — for some accounts the balanceAfter chain itself is broken
  // (see the sanity-bound rejection below), and "correcting" a row whose
  // stored amount was never actually wrong, just to make a broken chain look
  // consistent, would silently rewrite real transaction history.
  const CORRECTABLE_TYPES = new Set(['match_wager', 'match_win', 'match_refund']);

  // A real 1v1 wager on this platform tops out in the low thousands (starting
  // bonus is 100 Chuta; every observed legitimate account sits in the
  // 0-10,000 range). A reconstructed amount outside this is the fingerprint
  // of the OLD compounding-balance bug (a silently-erased debit letting a
  // balance multiply against itself on every subsequent write) rather than a
  // real transaction — for those, balanceAfter is corrupted too, so deriving
  // "the true amount" from it would just enshrine the corruption more deeply
  // instead of fixing it. Flagged for manual/business review instead.
  const SANITY_CEILING = 50000;

  const flaggedAccounts = [];

  for (const { userId } of userIds) {
    const txs = await ChutaCoinTransaction.findAll({
      where: { userId, status: 'completed' },
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    });

    const trueBalanceBefore = txs.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    if (trueBalanceBefore < 0) negativeBefore++;

    let running = 0;
    const corrections = [];
    let sawImplausible = false;
    for (const tx of txs) {
      const balanceAfter = parseFloat(tx.balanceAfter);
      const storedAmount = parseFloat(tx.amount);
      const expectedAmount = balanceAfter - running;
      const looksWrong = Math.abs(expectedAmount - storedAmount) > 0.001;

      if (looksWrong && !CORRECTABLE_TYPES.has(tx.type)) {
        // A non-correctable-type row disagreeing with the chain means the
        // chain itself is broken for this account — bail on the whole
        // account rather than cherry-pick which rows to "fix".
        sawImplausible = true;
      }
      if (looksWrong && CORRECTABLE_TYPES.has(tx.type) && Math.abs(expectedAmount) > SANITY_CEILING) {
        sawImplausible = true;
      }
      if (looksWrong && CORRECTABLE_TYPES.has(tx.type) && Math.abs(expectedAmount) <= SANITY_CEILING) {
        corrections.push({ tx, from: storedAmount, to: expectedAmount });
      }
      running = balanceAfter;
    }

    if (sawImplausible) {
      flaggedAccounts.push({ userId, trueBalanceBefore });
      console.log(`\n[user ${userId}] ⚠ FLAGGED, not auto-corrected — the balance chain looks broken beyond simple zeroed-amount rows (implausible reconstructed value, or a non-match-type row disagreeing with the chain). Needs manual review. Sum-of-stored-amounts: ${trueBalanceBefore.toFixed(2)}`);
      continue;
    }

    const trueBalanceAfter = running;
    if (trueBalanceAfter < 0) negativeAfter++;

    if (corrections.length === 0) continue;

    usersChanged++;
    console.log(`\n[user ${userId}] ${corrections.length} row(s) to correct. Balance: ${trueBalanceBefore.toFixed(2)} (wrong, sum-of-stored-amounts) -> ${trueBalanceAfter.toFixed(2)} (correct, from balanceAfter trail)`);
    for (const c of corrections) {
      console.log(`  [${c.tx.id}] ${c.tx.type} @ ${c.tx.createdAt.toISOString()}: amount ${c.from} -> ${c.to}`);
      rowsChanged++;
      if (!dryRun) {
        await c.tx.update({ amount: c.to });
      }
    }
  }

  console.log(`\n[Backfill] ${usersChanged} user(s), ${rowsChanged} row(s) ${dryRun ? 'would be' : 'were'} auto-corrected (simple zeroed-amount rows, plausible values only).`);
  console.log(`[Backfill] Users with a negative computed balance among auto-corrected accounts: ${negativeBefore} before -> ${negativeAfter} after.`);
  if (flaggedAccounts.length > 0) {
    console.log(`\n[Backfill] ⚠ ${flaggedAccounts.length} account(s) flagged for MANUAL review, not touched by this script:`);
    flaggedAccounts.forEach(a => console.log(`  - user ${a.userId} (current wrong sum-of-amounts balance: ${a.trueBalanceBefore.toFixed(2)})`));
  }

  await sequelize.close();
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
