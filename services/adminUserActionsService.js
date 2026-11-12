const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('../models/User');
const MultiCurrencyWalletService = require('./multiCurrencyWalletService');
const { sendCampaignMail } = require('./emailCampaignMailer');
const { renderCampaignEmail, sanitizeCampaignHtml } = require('../utils/campaignEmail');
const { isUserInsightsReady } = require('../utils/ensureUserInsights');

const walletService = new MultiCurrencyWalletService();
const CURRENCIES = ['NGN', 'USD'];
const MAX_AMOUNT = 999999999;
const DIRECTIONS = ['credit', 'debit'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_REASON_LENGTH = 5;
const MAX_SUBJECT_LENGTH = 200;

class UserActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const assertReady = () => {
  if (!isUserInsightsReady()) {
    throw new UserActionError(503, 'This is unavailable right now. Check the server logs.');
  }
};

const select = (sql, replacements) =>
  sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const run = (sql, replacements) => sequelize.query(sql, { replacements });

async function findTarget(id) {
  const user = Number.isInteger(Number(id)) ? await User.findByPk(id) : null;
  if (!user) throw new UserActionError(404, 'User not found');
  return user;
}

const hasText = (html) =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;

/** Sends one person a personal email, and keeps a record of it on their page. */
async function sendPersonalEmail({ userId, senderId, subject, preheader, bodyHtml }) {
  assertReady();
  const cleanSubject = String(subject || '').trim();
  const cleanBody = sanitizeCampaignHtml(bodyHtml);
  if (!cleanSubject || cleanSubject.length > MAX_SUBJECT_LENGTH) {
    throw new UserActionError(400, 'Add a subject line of up to 200 characters.');
  }
  if (!hasText(cleanBody)) throw new UserActionError(400, 'Write your message before sending.');

  const user = await findTarget(userId);
  const rendered = renderCampaignEmail(
    { subject: cleanSubject, preheader: String(preheader || '').trim(), bodyHtml: cleanBody },
    { email: user.email, firstName: user.firstname, lastName: user.lastname }
  );

  const [row] = await select(
    `INSERT INTO admin_user_emails (user_id, sender_id, subject, body_html)
     VALUES (:userId, :senderId, :subject, :bodyHtml) RETURNING id`,
    { userId: user.id, senderId, subject: rendered.subject.slice(0, 255), bodyHtml: cleanBody }
  );

  try {
    await sendCampaignMail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: rendered.unsubscribeUrl,
      recipientId: row.id,
    });
  } catch (error) {
    await run(`UPDATE admin_user_emails SET status = 'failed', error = :error WHERE id = :id`, {
      id: row.id,
      error: String(error.message || error).slice(0, 500),
    });
    throw new UserActionError(502, 'The email couldn’t be sent. Please try again.');
  }

  await run(`UPDATE admin_user_emails SET status = 'sent' WHERE id = :id`, { id: row.id });
  return { id: row.id, status: 'sent' };
}

function validateAdjustment({ userId, adminId, currency, direction, amount, reason, idempotencyKey }) {
  if (Number(userId) === Number(adminId)) {
    throw new UserActionError(403, 'You can’t adjust your own wallet.');
  }
  if (!CURRENCIES.includes(currency)) throw new UserActionError(400, 'Choose NGN or USD.');
  if (!DIRECTIONS.includes(direction)) throw new UserActionError(400, 'Choose credit or debit.');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new UserActionError(400, 'Enter an amount above zero.');
  }
  if (amount > MAX_AMOUNT) throw new UserActionError(400, 'That amount is too large.');
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(6))) {
    throw new UserActionError(400, 'Use at most 2 decimal places.');
  }
  if (String(reason || '').trim().length < MIN_REASON_LENGTH) {
    throw new UserActionError(400, 'Give a reason so this can be understood later.');
  }
  if (!UUID_RE.test(String(idempotencyKey || ''))) {
    throw new UserActionError(400, 'This request is missing its safety key.');
  }
}

/**
 * Credits or debits a wallet through the same locked, overdraft-protected path
 * as every other wallet movement. The idempotency key means a double click or a
 * retried request can never move the money twice.
 */
async function adjustWallet(input) {
  assertReady();
  validateAdjustment(input);
  const { userId, adminId, currency, direction, amount, idempotencyKey } = input;
  const reason = String(input.reason).trim();
  const user = await findTarget(userId);

  const [claimed] = await select(
    `INSERT INTO admin_wallet_adjustments (user_id, admin_id, currency, direction, amount, reason, idempotency_key)
     VALUES (:userId, :adminId, :currency, :direction, :amount, :reason, :idempotencyKey)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    { userId: user.id, adminId, currency, direction, amount, reason, idempotencyKey }
  );

  if (!claimed) {
    const [existing] = await select(
      `SELECT id, status, balance_after AS "balanceAfter" FROM admin_wallet_adjustments WHERE idempotency_key = :idempotencyKey`,
      { idempotencyKey }
    );
    if (existing?.status === 'completed') {
      return { id: existing.id, balanceAfter: Number(existing.balanceAfter), duplicate: true };
    }
    throw new UserActionError(409, 'This adjustment was already submitted. Refresh to see its result.');
  }

  try {
    const move = direction === 'credit' ? 'creditWallet' : 'debitWallet';
    await walletService[move]({
      userId: user.id,
      currency,
      amount,
      reference: `admin_adj_${claimed.id}`,
      description: `Admin adjustment: ${reason}`.slice(0, 255),
      metadata: { adminId, adjustmentId: claimed.id, idempotencyKey: claimed.id, reason },
    });
  } catch (error) {
    await run(`UPDATE admin_wallet_adjustments SET status = 'failed', error = :error WHERE id = :id`, {
      id: claimed.id,
      error: String(error.message || error).slice(0, 500),
    });
    if (/insufficient/i.test(error.message || '')) {
      throw new UserActionError(400, 'The wallet doesn’t have enough available balance for that debit.');
    }
    throw new UserActionError(500, 'The wallet couldn’t be adjusted. No money was moved.');
  }

  // The money has moved. A problem writing the receipt must not read as a failure.
  let balanceAfter = null;
  try {
    const [account] = await select(
      'SELECT balance_available FROM wallet_accounts WHERE user_id = :userId AND currency = :currency',
      { userId: user.id, currency }
    );
    balanceAfter = Number(account?.balance_available || 0) / 100;
    await run(`UPDATE admin_wallet_adjustments SET status = 'completed', balance_after = :balanceAfter WHERE id = :id`, {
      id: claimed.id,
      balanceAfter,
    });
  } catch (error) {
    console.error(`[AdminWallet] Adjustment ${claimed.id} applied but not marked complete:`, error.message);
  }

  console.log(`[AdminWallet] ${direction} ${amount} ${currency} on user ${user.id} by admin ${adminId}: ${reason}`);
  return { id: claimed.id, balanceAfter, duplicate: false };
}

module.exports = { UserActionError, sendPersonalEmail, adjustWallet };
