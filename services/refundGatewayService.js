/**
 * Sends refunds back through the gateway that took the payment ("the money
 * leaves where it entered"): Paystack for its payments, Stripe for its own.
 *
 * Every failure is sorted into one of two kinds, because the caller acts
 * differently on each:
 *   - definite: the gateway answered and said no. Nothing moved; the refund
 *     can be marked failed and tried again later.
 *   - uncertain: no answer (timeout, network, gateway 5xx). The money may or
 *     may not have moved, so the refund stays open and is re-checked. Retries
 *     are safe: Stripe calls carry an idempotency key, and Paystack is asked
 *     whether the payment was already reversed before refunding again.
 */
const { paystackClient } = require('../config/paystack');
const { stripeClient } = require('../config/stripe');

class GatewayRefundError extends Error {
  constructor(message, definite) {
    super(message);
    this.name = 'GatewayRefundError';
    this.definite = definite;
  }
}

const TIMEOUT_MS = 20000;
const DONE = new Set(['processed', 'succeeded', 'already_reversed']);
const FAILED = new Set(['failed', 'canceled', 'cancelled']);

/** done | failed | pending — the gateway's own words mapped to three outcomes. */
function outcomeOf(status) {
  const value = String(status || '').toLowerCase();
  if (DONE.has(value)) return 'done';
  if (FAILED.has(value)) return 'failed';
  return 'pending';
}

function fromPaystackError(error, action) {
  const status = error.response?.status;
  const message = error.response?.data?.message;
  if (status && status < 500) return new GatewayRefundError(message || `Paystack refused to ${action}.`, true);
  return new GatewayRefundError(`Paystack didn’t answer while trying to ${action}.`, false);
}

function fromStripeError(error, action) {
  const status = error.statusCode;
  if (status && status < 500) return new GatewayRefundError(error.message || `Stripe refused to ${action}.`, true);
  return new GatewayRefundError(`Stripe didn’t answer while trying to ${action}.`, false);
}

// --- Paystack ---------------------------------------------------------------

/** The payment as Paystack sees it. Paystack marks a fully refunded payment as reversed. */
async function paystackPayment(reference) {
  try {
    const { data } = await paystackClient.get(`/transaction/verify/${encodeURIComponent(reference)}`, { timeout: TIMEOUT_MS });
    return { id: data?.data?.id ?? null, reversed: /revers/i.test(String(data?.data?.status || '')) };
  } catch (error) {
    throw fromPaystackError(error, 'look up the payment');
  }
}

/** A refund Paystack already has for this payment (from an attempt we never heard back from). Best effort. */
async function paystackExistingRefund(transactionId) {
  if (transactionId == null) return null;
  try {
    const { data } = await paystackClient.get('/refund', { params: { transaction: transactionId }, timeout: TIMEOUT_MS });
    const found = (Array.isArray(data?.data) ? data.data : []).find((r) => !FAILED.has(String(r?.status || '').toLowerCase()));
    return found ? { id: found.id != null ? String(found.id) : null, status: found.status || 'pending' } : null;
  } catch {
    return null; // Paystack itself refuses a second refund of the same payment.
  }
}

async function paystackRefund({ reference, note }) {
  const payment = await paystackPayment(reference);
  if (payment.reversed) return { id: null, status: 'already_reversed' };
  const existing = await paystackExistingRefund(payment.id);
  if (existing) return existing;
  try {
    const { data } = await paystackClient.post(
      '/refund',
      { transaction: reference, merchant_note: String(note || '').slice(0, 200) || undefined },
      { timeout: TIMEOUT_MS }
    );
    const refund = data?.data || {};
    return { id: refund.id != null ? String(refund.id) : null, status: refund.status || 'pending' };
  } catch (error) {
    throw fromPaystackError(error, 'refund this payment');
  }
}

async function paystackRefundStatus(refundId) {
  try {
    const { data } = await paystackClient.get(`/refund/${encodeURIComponent(refundId)}`, { timeout: TIMEOUT_MS });
    return data?.data?.status || 'pending';
  } catch (error) {
    throw fromPaystackError(error, 'check the refund');
  }
}

// --- Stripe -------------------------------------------------------------------

/** Purchases store the Checkout Session id; refunds need its PaymentIntent. */
async function stripePaymentIntentFor(reference) {
  if (reference.startsWith('pi_')) return reference;
  if (!reference.startsWith('cs_')) throw new GatewayRefundError('This isn’t a Stripe payment reference.', true);
  try {
    const session = await stripeClient.checkout.sessions.retrieve(reference);
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intent) throw new GatewayRefundError('Stripe has no completed charge for this payment.', true);
    return intent;
  } catch (error) {
    if (error instanceof GatewayRefundError) throw error;
    throw fromStripeError(error, 'look up the payment');
  }
}

async function stripeRefund({ reference, idempotencyKey }) {
  const paymentIntent = await stripePaymentIntentFor(reference);
  try {
    const refund = await stripeClient.refunds.create(
      { payment_intent: paymentIntent, reason: 'requested_by_customer', metadata: { hallos_refund_id: idempotencyKey } },
      { idempotencyKey: `hallos-refund-${idempotencyKey}` }
    );
    return { id: refund.id, status: refund.status || 'pending' };
  } catch (error) {
    throw fromStripeError(error, 'refund this payment');
  }
}

async function stripeRefundStatus(refundId) {
  try {
    const refund = await stripeClient.refunds.retrieve(refundId);
    return refund.status || 'pending';
  } catch (error) {
    throw fromStripeError(error, 'check the refund');
  }
}

// --- Public -------------------------------------------------------------------

/** Refund the whole payment. Returns { id, status } as the gateway reported them. */
async function refund({ gateway, reference, idempotencyKey, note }) {
  if (gateway === 'paystack') return paystackRefund({ reference, note });
  if (gateway === 'stripe') return stripeRefund({ reference, idempotencyKey });
  throw new GatewayRefundError(`Refunds aren’t supported for ${gateway || 'this'} payments.`, true);
}

async function refundStatus({ gateway, refundId }) {
  if (gateway === 'paystack') return paystackRefundStatus(refundId);
  if (gateway === 'stripe') return stripeRefundStatus(refundId);
  throw new GatewayRefundError(`Refunds aren’t supported for ${gateway || 'this'} payments.`, true);
}

module.exports = { refund, refundStatus, outcomeOf, GatewayRefundError };
