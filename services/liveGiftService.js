const { v4: uuidv4 } = require('uuid');
const sequelize = require('../config/db');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const LiveGift = require('../models/LiveGift');
const { LIVE_GIFTS, HOST_SHARE_PERCENT, giftByCode } = require('../config/liveGifts');

/**
 * Gifts in GetStream live rooms: an attendee pays from their wallet and the
 * host receives HOST_SHARE_PERCENT (the rest is the platform fee).
 *
 * Self-contained on purpose — it doesn't change the shared wallet services.
 * One database transaction locks the sender's and host's wallet rows (in a
 * fixed order, so two gifts can never deadlock), checks the balance under the
 * lock, moves the money, writes both wallet history rows and the gift record.
 * Any failure rolls all of it back. A repeated idempotency key returns the
 * gift already sent instead of charging again.
 */

const CURRENCIES = ['NGN', 'USD'];

class GiftError extends Error {
  constructor(message, code, status = 400, details = {}) {
    super(message);
    this.name = 'GiftError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const toMinor = (amount) => Math.round(amount * 100);
const toMajor = (minor) => Number(minor) / 100;

/** The class's currency first, then the other one. */
const currencyPreference = (contentCurrency) => {
  const first = CURRENCIES.includes(contentCurrency) ? contentCurrency : 'NGN';
  return [first, ...CURRENCIES.filter((c) => c !== first)];
};

/** Catalogue as the browser sees it. */
const catalog = () =>
  LIVE_GIFTS.map(({ code, name, emoji, animation, prices }) => ({ code, name, emoji, animation, prices }));

/** Available wallet balances in currency units ({ NGN, USD }); missing wallets count as 0. */
const balancesOf = async (userId) => {
  const rows = await WalletAccount.findAll({ where: { user_id: userId }, attributes: ['currency', 'balance_available'] });
  const balances = { NGN: 0, USD: 0 };
  for (const row of rows) {
    if (CURRENCIES.includes(row.currency)) balances[row.currency] = toMajor(row.balance_available);
  }
  return balances;
};

/** What a person (the host) has received in this class/session, per currency (after the platform fee). */
const hostTotals = async (contentType, contentId, recipientId) => {
  const rows = await LiveGift.findAll({
    where: { contentType, contentId, recipientId },
    attributes: ['currency', [sequelize.fn('SUM', sequelize.col('host_amount')), 'total'], [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['currency'],
    raw: true
  });
  const totals = { NGN: 0, USD: 0 };
  let count = 0;
  for (const row of rows) {
    if (CURRENCIES.includes(row.currency)) totals[row.currency] = toMajor(row.total);
    count += Number(row.count) || 0;
  }
  return { totals, count };
};

const isUniqueViolation = (error) => error && error.name === 'SequelizeUniqueConstraintError';

const findExisting = (senderId, idempotencyKey) => LiveGift.findOne({ where: { senderId, idempotencyKey } });

/**
 * Send a gift.
 * @param {object} p
 * @param {number} p.senderId
 * @param {number} p.recipientId  the host
 * @param {'live_class'|'live_session'} p.contentType
 * @param {string} p.contentId
 * @param {string} p.contentCurrency  the class/series currency (tried first)
 * @param {string} p.giftCode
 * @param {string} p.idempotencyKey  one per tap in the browser
 * @returns {Promise<{ gift: LiveGift, replay: boolean }>}
 */
const sendGift = async ({ senderId, recipientId, contentType, contentId, contentCurrency, giftCode, idempotencyKey }) => {
  const gift = giftByCode(giftCode);
  if (!gift) throw new GiftError('Unknown gift', 'UNKNOWN_GIFT', 400);
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 100) {
    throw new GiftError('A request key is required', 'IDEMPOTENCY_KEY_REQUIRED', 400);
  }
  if (!recipientId) throw new GiftError('This class has no host to receive gifts', 'NO_RECIPIENT', 400);
  if (senderId === recipientId) throw new GiftError("You can't send a gift to yourself", 'SELF_GIFT', 400);

  const existing = await findExisting(senderId, idempotencyKey);
  if (existing) return { gift: existing, replay: true };

  try {
    const record = await sequelize.transaction(async (transaction) => {
      // Make sure all four wallet rows exist, then lock them in a fixed order.
      const parties = [senderId, recipientId];
      for (const userId of parties) {
        for (const currency of CURRENCIES) {
          await WalletAccount.findOrCreate({
            where: { user_id: userId, currency },
            defaults: { user_id: userId, currency, balance_available: 0, balance_pending: 0 },
            transaction
          });
        }
      }
      const locked = await WalletAccount.findAll({
        where: { user_id: parties, currency: CURRENCIES },
        order: [['user_id', 'ASC'], ['currency', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction
      });
      const walletOf = (userId, currency) => locked.find((w) => w.user_id === userId && w.currency === currency);

      // Pay from the first wallet (class currency first) that has enough.
      const currency = currencyPreference(contentCurrency).find(
        (c) => Number(walletOf(senderId, c).balance_available) >= toMinor(gift.prices[c])
      );
      if (!currency) {
        throw new GiftError('Not enough money in your wallet for this gift', 'INSUFFICIENT_FUNDS', 402, {
          prices: gift.prices
        });
      }

      const amount = toMinor(gift.prices[currency]);
      const hostAmount = Math.floor((amount * HOST_SHARE_PERCENT) / 100);
      const platformFee = amount - hostAmount;
      const giftId = uuidv4();
      const senderWallet = walletOf(senderId, currency);
      const hostWallet = walletOf(recipientId, currency);

      await senderWallet.update(
        { balance_available: Number(senderWallet.balance_available) - amount },
        { transaction }
      );
      await hostWallet.update(
        { balance_available: Number(hostWallet.balance_available) + hostAmount },
        { transaction }
      );

      const history = (wallet, type, value, suffix, description, extra) =>
        WalletTransaction.create(
          {
            wallet_account_id: wallet.id,
            transaction_type: type,
            amount: value,
            currency,
            reference: `GIFT-${giftId}-${suffix}`,
            description,
            metadata: { kind: 'live_gift', giftId, giftCode: gift.code, contentType, contentId, currency, ...extra },
            status: 'completed',
            idempotency_key: uuidv4(),
            created_at: new Date(),
            completed_at: new Date()
          },
          { transaction }
        );
      await history(senderWallet, 'transfer_out', amount, 'S', `Gift sent: ${gift.name} ${gift.emoji}`, {
        toUserId: recipientId
      });
      await history(hostWallet, 'transfer_in', hostAmount, 'H', `Gift received: ${gift.name} ${gift.emoji}`, {
        fromUserId: senderId,
        platformFee
      });

      return LiveGift.create(
        {
          id: giftId,
          senderId,
          recipientId,
          contentType,
          contentId,
          giftCode: gift.code,
          currency,
          amount,
          hostAmount,
          platformFee,
          idempotencyKey
        },
        { transaction }
      );
    });

    console.log(
      `[LiveGift] ${record.giftCode} ${toMajor(record.amount)} ${record.currency} from ${senderId} to ${recipientId} (${contentType} ${contentId})`
    );
    return { gift: record, replay: false };
  } catch (error) {
    // The same tap raced in twice: the unique index let one through.
    if (isUniqueViolation(error)) {
      const raced = await findExisting(senderId, idempotencyKey);
      if (raced) return { gift: raced, replay: true };
    }
    throw error;
  }
};

/** Public shape of a gift for API responses. */
const describeGift = (record) => {
  const gift = giftByCode(record.giftCode);
  return {
    id: record.id,
    code: record.giftCode,
    name: gift ? gift.name : record.giftCode,
    emoji: gift ? gift.emoji : '🎁',
    currency: record.currency,
    amount: toMajor(record.amount)
  };
};

module.exports = {
  liveGiftService: { catalog, balancesOf, hostTotals, sendGift, describeGift },
  GiftError,
  // Exported for tests.
  currencyPreference
};
