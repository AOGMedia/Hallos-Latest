const sequelize = require('../config/db');

/**
 * financial_transactions.reference was VARCHAR(50), but Stripe Checkout
 * session ids are about 66 characters. Credits under those references failed
 * to insert, and because the insert error was swallowed inside the wallet
 * transaction, the balance change was silently rolled back too: creators were
 * never credited for Stripe sales. Widening fixes every future sale.
 *
 * Widening a VARCHAR is instant in Postgres (no table rewrite, no reindex).
 * It still needs a brief exclusive lock, so it gives up after a few seconds
 * rather than queue behind live traffic, and simply tries again next boot.
 * Never throws.
 */
const TARGET_LENGTH = 255;

async function ensureLedgerReferences() {
  try {
    const [rows] = await sequelize.query(
      `SELECT character_maximum_length AS length FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'financial_transactions' AND column_name = 'reference'`
    );
    const length = rows[0]?.length;
    if (length == null || Number(length) >= TARGET_LENGTH) return; // missing table, or already wide enough / unlimited
    await sequelize.transaction(async (transaction) => {
      await sequelize.query("SET LOCAL lock_timeout = '5s'", { transaction });
      await sequelize.query(`ALTER TABLE financial_transactions ALTER COLUMN reference TYPE VARCHAR(${TARGET_LENGTH})`, { transaction });
    });
    console.log(`✅ Wallet ledger references widened from ${length} to ${TARGET_LENGTH} characters`);
  } catch (error) {
    console.error('⚠️ Could not widen wallet ledger references (will retry next start):', error.message);
  }
}

module.exports = { ensureLedgerReferences };
