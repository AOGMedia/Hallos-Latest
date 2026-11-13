const sequelize = require('../config/db');

/**
 * Storage for staff-issued refunds. Runs on boot like the other ensure*
 * helpers: every statement can run again safely and this never throws. If it
 * can't run, refunds are unavailable and nothing else changes.
 *
 * It also lets purchases be marked 'refunded'. Access checks only accept
 * 'completed' purchases, so a refunded purchase stops unlocking content
 * everywhere without touching those checks.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS payment_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_reference VARCHAR(255) NOT NULL,
    source VARCHAR(20) NOT NULL,
    source_id VARCHAR(64) NOT NULL,
    buyer_id INTEGER NOT NULL,
    content_type VARCHAR(30),
    content_id VARCHAR(64),
    amount NUMERIC(14, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    gateway VARCHAR(20) NOT NULL,
    gateway_refund_id VARCHAR(255),
    gateway_status VARCHAR(40),
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    reason TEXT NOT NULL,
    reversals JSONB NOT NULL DEFAULT '[]'::jsonb,
    unrecovered NUMERIC(14, 2) NOT NULL DEFAULT 0,
    failure_message TEXT,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
  )`,
  // One live refund per payment: a failed attempt can be retried, nothing can be refunded twice.
  "CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_one_active ON payment_refunds (payment_reference) WHERE status <> 'failed'",
  'CREATE INDEX IF NOT EXISTS payment_refunds_created ON payment_refunds (created_at DESC)',
];

let ready = false;
const isRefundsReady = () => ready;

/** Adds 'refunded' to purchases.payment_status when that column is a Postgres enum. */
async function allowRefundedPurchases() {
  const [rows] = await sequelize.query(
    `SELECT data_type, udt_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'purchases' AND column_name = 'payment_status'`
  );
  const column = rows[0];
  if (!column) throw new Error('purchases.payment_status not found');
  if (column.data_type !== 'USER-DEFINED') return; // text column: any value is allowed
  const typeName = String(column.udt_name).replace(/"/g, '""');
  await sequelize.query(`ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS 'refunded'`);
}

async function ensureRefunds() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    await allowRefundedPurchases();
    ready = true;
    console.log('✅ Refunds ready');
  } catch (error) {
    ready = false;
    console.error('⚠️ Refunds setup failed; refunds are unavailable:', error.message);
  }
}

module.exports = { ensureRefunds, isRefundsReady };
