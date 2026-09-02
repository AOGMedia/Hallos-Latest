const sequelize = require('../config/db');
const ChutaCoinTransaction = require('../models/ChutaCoinTransaction');
const UserQuizStats = require('../models/UserQuizStats');

/**
 * Quiz Wallet Service
 * 
 * Manages Chuta coin operations for the quiz platform:
 * - Currency conversions (USD ↔ Morgan ↔ Chuta)
 * - Initial bonus credits
 * - Purchases and withdrawals (Option B - Unified Bridge)
 * - Escrow management for wagers
 * - Transaction recording
 * 
 * Currency System:
 * - 1 USD = 1 Morgan = 100 Chuta
 * - 1 Chuta = $0.01 USD (1 cent)
 * - 1 USD = 1400 NGN (from environment)
 */

class QuizWalletService {
  // Currency conversion rates
  static CHUTA_PER_USD = 100;
  static CHUTA_PER_MORGAN = 100;
  static INITIAL_BONUS = 100; // Chuta
  static MIN_WITHDRAWAL = 1000; // Chuta (= $10 USD)
  static WITHDRAWAL_FEE_PERCENT = 10;

  /**
   * Convert USD to Chuta
   * @param {number} usd - Amount in USD
   * @returns {number} - Amount in Chuta
   */
  usdToChuta(usd) {
    return Math.floor(usd * QuizWalletService.CHUTA_PER_USD);
  }

  /**
   * Convert Chuta to USD
   * @param {number} chuta - Amount in Chuta
   * @returns {number} - Amount in USD
   */
  chutaToUsd(chuta) {
    return chuta / QuizWalletService.CHUTA_PER_USD;
  }

  /**
   * Convert Morgan to Chuta
   * @param {number} morgan - Amount in Morgan
   * @returns {number} - Amount in Chuta
   */
  morganToChuta(morgan) {
    return Math.floor(morgan * QuizWalletService.CHUTA_PER_MORGAN);
  }

  /**
   * Convert Chuta to Morgan
   * @param {number} chuta - Amount in Chuta
   * @returns {number} - Amount in Morgan
   */
  chutaToMorgan(chuta) {
    return chuta / QuizWalletService.CHUTA_PER_MORGAN;
  }

  /**
   * Get user's Morgan Point balance.
   *
   * Derived by summing the ledger, NOT by reading `balanceAfter` off the most
   * recent row. The previous implementation did the latter, which made the
   * balance a cached value that could drift permanently above the truth:
   *
   *   - `recordTransaction` read the balance, added to it, then wrote a new
   *     row. With no lock and no shared transaction, two concurrent writes for
   *     the same user both read the same starting value, and the second
   *     silently erased the first. Because only the newest row was consulted,
   *     an erased *debit* vanished while the *credit* survived — money created
   *     from nothing, compounding forever after since every later balance was
   *     derived from the corrupted row.
   *   - Ordering by `createdAt` (millisecond resolution) tie-breaks
   *     arbitrarily, so simultaneous rows could resolve to the wrong one.
   *
   * Summing makes the ledger the single source of truth, so any historical
   * drift self-corrects the moment this ships, with no data migration.
   * `balanceAfter` is still written for audit/history, but is never trusted
   * for computing a balance.
   *
   * Only 'completed' rows count: the status enum allows 'failed'/'reversed',
   * and those must never affect spendable balance.
   *
   * @param {number} userId - User ID
   * @param {import('sequelize').Transaction} [transaction] - Caller's
   *   transaction. MUST be passed when the balance is being read as part of a
   *   check-then-write (wagering, withdrawing, entering a tournament), so the
   *   read sees the caller's own uncommitted rows and is serialised by the
   *   caller's advisory lock. Omitting it reads committed state only.
   * @returns {Promise<number>} - Balance in Morgan Points
   */
  async getBalance(userId, transaction = null) {
    const result = await ChutaCoinTransaction.findOne({
      where: { userId, status: 'completed' },
      attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
      raw: true,
      transaction
    });

    // SUM over DECIMAL comes back as a string from Postgres.
    const total = parseFloat(result?.total ?? 0);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Credit initial bonus to new user (idempotent)
   * @param {number} userId - User ID
   * @param {string} nickname - Quiz platform nickname
   * @param {string} avatarUrl - DiceBear avatar URL
   * @returns {Promise<{success: boolean, balance: number, transaction: Object}>}
   */
  async creditInitialBonus(userId, nickname, avatarUrl) {
    // Take the per-user wallet lock before the "already credited?" check, so
    // two simultaneous registration requests can't both find no bonus row and
    // both credit one. The lock is transaction-scoped, so this whole
    // check-then-credit runs as one serialised unit per user.
    return sequelize.transaction(async (t) => {
      await this.lockUserWallet(userId, t);

      const existingBonus = await ChutaCoinTransaction.findOne({
        where: { userId, type: 'initial_bonus' },
        transaction: t
      });

      if (existingBonus) {
        const currentBalance = await this.getBalance(userId, t);
        return {
          success: false,
          message: 'Initial bonus already credited',
          balance: currentBalance,
          transaction: null
        };
      }

      return this._creditInitialBonusUnlocked(userId, nickname, avatarUrl, t);
    });
  }

  /**
   * Inner half of creditInitialBonus. Assumes the caller already holds the
   * per-user wallet lock and has confirmed no bonus exists.
   * @private
   */
  async _creditInitialBonusUnlocked(userId, nickname, avatarUrl, t) {
    // Check nickname uniqueness
    const existingNickname = await UserQuizStats.findOne({
      where: { nickname },
      transaction: t
    });
    if (existingNickname) {
      throw new Error('Nickname already taken. Please choose a different one.');
    }

    // Credit the bonus
    const transaction = await this.recordTransaction(
      userId,
      'initial_bonus',
      QuizWalletService.INITIAL_BONUS,
      { description: 'Welcome bonus' },
      t
    );

    // Initialize user quiz stats with nickname and avatar
    await UserQuizStats.findOrCreate({
      where: { userId },
      defaults: { userId, nickname, avatarUrl },
      transaction: t
    });

    // If stats already existed (edge case), update nickname/avatar
    await UserQuizStats.update(
      { nickname, avatarUrl },
      { where: { userId, nickname: null }, transaction: t }
    );

    return {
      success: true,
      balance: parseFloat(transaction.balanceAfter),
      nickname,
      avatarUrl,
      transaction
    };
  }

  /**
   * Purchase Chuta by transferring from platform wallet (Option B - Unified Bridge)
   * @param {number} userId - User ID
   * @param {number} amount - Amount to transfer (in USD or NGN)
   * @param {string} currency - Source currency ('USD' or 'NGN')
   * @returns {Promise<{success: boolean, chutaAmount: number, newBalance: number, transactionId: string}>}
   */
  async purchaseCurrency(userId, amount, currency = 'USD') {
    const MultiCurrencyWalletService = require('./multiCurrencyWalletService');
    const platformWalletService = new MultiCurrencyWalletService();

    // Validate currency
    if (!['USD', 'NGN'].includes(currency)) {
      throw new Error('Currency must be USD or NGN');
    }

    if (amount < 1) {
      throw new Error(`Minimum purchase is 1 ${currency}`);
    }

    // Convert to USD if NGN
    let usdAmount = amount;
    if (currency === 'NGN') {
      const conversionRate = parseFloat(process.env.CURRENCY_CONVERSION_RATE_NGN_TO_USD);
      usdAmount = amount / conversionRate;
    }

    // Convert USD to Chuta
    const chutaAmount = this.usdToChuta(usdAmount);

    // Use database transaction for atomicity
    const result = await sequelize.transaction(async (t) => {
      // 1. Debit platform wallet
      await platformWalletService.debitWallet({
        userId,
        currency,
        amount,
        reference: `quiz_purchase_${Date.now()}`,
        description: `Transfer to quiz wallet: ${chutaAmount} Chuta`,
        metadata: { type: 'quiz_purchase', chutaAmount }
      });

      // 2. Credit quiz wallet
      const transaction = await this.recordTransaction(
        userId,
        'purchase',
        chutaAmount,
        {
          sourceAmount: amount,
          sourceCurrency: currency,
          usdAmount,
          conversionRate: currency === 'NGN' ? process.env.CURRENCY_CONVERSION_RATE_NGN_TO_USD : 1,
          description: `Purchased ${chutaAmount} Chuta from ${currency} wallet`
        },
        t
      );

      return {
        success: true,
        chutaAmount,
        newBalance: parseFloat(transaction.balanceAfter),
        transactionId: transaction.id,
        sourceAmount: amount,
        sourceCurrency: currency
      };
    });

    return result;
  }

  /**
   * Withdraw Chuta back to platform wallet (Option B - Unified Bridge)
   * @param {number} userId - User ID
   * @param {number} chutaAmount - Amount in Chuta
   * @param {string} targetCurrency - Target currency ('USD' or 'NGN')
   * @returns {Promise<{success: boolean, amount: number, currency: string, feeAmount: number, newBalance: number, transactionId: string}>}
   */
  async withdrawFunds(userId, chutaAmount, targetCurrency = 'USD') {
    const MultiCurrencyWalletService = require('./multiCurrencyWalletService');
    const platformWalletService = new MultiCurrencyWalletService();

    // Validate currency
    if (!['USD', 'NGN'].includes(targetCurrency)) {
      throw new Error('Target currency must be USD or NGN');
    }

    // Validate minimum withdrawal
    if (chutaAmount < QuizWalletService.MIN_WITHDRAWAL) {
      throw new Error(`Minimum withdrawal is ${QuizWalletService.MIN_WITHDRAWAL} Chuta ($${this.chutaToUsd(QuizWalletService.MIN_WITHDRAWAL)})`);
    }

    // NOTE: the sufficient-balance check deliberately happens INSIDE the
    // transaction below, under the per-user lock. Checking out here first —
    // as this used to — is a classic double-spend window: two concurrent
    // withdrawals could both read the same balance, both pass, and both pay
    // out to the platform wallet. This is the one path where that means real
    // money leaving the system twice.

    // Calculate fee (10%)
    const feeAmount = Math.floor(chutaAmount * (QuizWalletService.WITHDRAWAL_FEE_PERCENT / 100));
    const netChuta = chutaAmount - feeAmount;
    
    // Convert to USD first
    const usdAmount = this.chutaToUsd(netChuta);

    // Convert to target currency if NGN
    let targetAmount = usdAmount;
    if (targetCurrency === 'NGN') {
      const conversionRate = parseFloat(process.env.CURRENCY_CONVERSION_RATE_NGN_TO_USD) || 1400;
      targetAmount = usdAmount * conversionRate;
    }

    // Use database transaction for atomicity
    const result = await sequelize.transaction(async (t) => {
      // Serialise against any other wallet write for this user, then verify
      // the balance under that lock before paying anything out.
      await this.lockUserWallet(userId, t);
      const currentBalance = await this.getBalance(userId, t);
      if (currentBalance < chutaAmount) {
        throw new Error('Insufficient balance');
      }

      // 1. Debit quiz wallet
      const transaction = await this.recordTransaction(
        userId,
        'withdrawal',
        -chutaAmount,
        {
          targetAmount,
          targetCurrency,
          usdAmount,
          feeAmount,
          netChuta,
          conversionRate: targetCurrency === 'NGN' ? process.env.CURRENCY_CONVERSION_RATE_NGN_TO_USD : 1,
          description: `Withdrew ${chutaAmount} Chuta (${feeAmount} fee) to ${targetCurrency} wallet`
        },
        t
      );

      // 2. Credit platform wallet
      await platformWalletService.creditWallet({
        userId,
        currency: targetCurrency,
        amount: targetAmount,
        reference: `quiz_withdrawal_${Date.now()}`,
        description: `Withdrawal from quiz wallet: ${chutaAmount} Chuta`,
        metadata: { type: 'quiz_withdrawal', chutaAmount, feeAmount }
      });

      return {
        success: true,
        amount: targetAmount,
        currency: targetCurrency,
        feeAmount,
        newBalance: parseFloat(transaction.balanceAfter),
        transactionId: transaction.id
      };
    });

    return result;
  }

  /**
   * Escrow funds for a match wager
   * @param {number} userId - User ID
   * @param {number} amount - Amount in Chuta
   * @param {string} matchId - Match UUID
   * @returns {Promise<{success: boolean, escrowedAmount: number, newBalance: number}>}
   */
  async escrowFunds(userId, amount, matchId) {
    // Check and debit under one lock, in one transaction. Previously the check
    // ran outside any transaction, so a player could stake the same balance in
    // two matches accepted at the same moment. recordTransaction's own
    // negative-balance guard would still catch the extreme case, but only
    // after the fact and with a confusing error — this fails cleanly instead.
    return sequelize.transaction(async (t) => {
      await this.lockUserWallet(userId, t);

      const currentBalance = await this.getBalance(userId, t);
      if (currentBalance < amount) {
        throw new Error('Insufficient balance for wager');
      }

      const transaction = await this.recordTransaction(
        userId,
        'match_wager',
        -amount,
        {
          matchId,
          description: `Escrowed ${amount} Chuta for match`
        },
        t
      );

      return {
        success: true,
        escrowedAmount: amount,
        newBalance: parseFloat(transaction.balanceAfter)
      };
    });
  }

  /**
   * Release escrowed funds to winner
   * @param {string} matchId - Match UUID
   * @param {number} winnerId - Winner user ID
   * @param {number} amount - Total escrowed amount
   * @returns {Promise<{success: boolean, prizeAmount: number, newBalance: number}>}
   */
  async releaseEscrow(matchId, winnerId, amount) {
    const transaction = await this.recordTransaction(
      winnerId,
      'match_win',
      amount,
      {
        matchId,
        description: `Won ${amount} Chuta from match`
      }
    );

    return {
      success: true,
      prizeAmount: amount,
      newBalance: parseFloat(transaction.balanceAfter)
    };
  }

  /**
   * Refund escrowed funds (match cancelled/declined)
   * @param {string} matchId - Match UUID
   * @param {Array<{userId: number, amount: number}>} refunds - Array of refund objects
   * @returns {Promise<{success: boolean, refundCount: number}>}
   */
  async refundEscrow(matchId, refunds) {
    await sequelize.transaction(async (t) => {
      for (const { userId, amount } of refunds) {
        await this.recordTransaction(
          userId,
          'match_refund',
          amount,
          {
            matchId,
            description: `Refunded ${amount} Chuta from cancelled match`
          },
          t
        );
      }
    });

    return {
      success: true,
      refundCount: refunds.length
    };
  }

  /**
   * Serialize concurrent balance-affecting operations for one user.
   *
   * Balance is derived from the latest ChutaCoinTransaction row rather than a
   * maintained counter, so two concurrent debits can both read the same
   * "current" balance and both succeed even if combined they overdraw the
   * user. A Postgres transaction-scoped advisory lock keyed by userId closes
   * that window without requiring a schema change — it's automatically
   * released on commit/rollback. Caller MUST be inside a `transaction`.
   *
   * @param {number} userId
   * @param {import('sequelize').Transaction} transaction
   */
  async lockUserWallet(userId, transaction) {
    if (!transaction) {
      throw new Error('lockUserWallet requires an active transaction');
    }
    await sequelize.query('SELECT pg_advisory_xact_lock(:userId);', {
      replacements: { userId: Number(userId) },
      transaction
    });
  }

  /**
   * Deduct tournament entry fee
   * @param {number} userId - User ID
   * @param {number} entryFee - Entry fee in Chuta
   * @param {string} tournamentId - Tournament UUID
   * @param {import('sequelize').Transaction} [transaction] - Pass the caller's
   *   transaction so this debit is atomic with whatever else the caller does
   *   (e.g. creating the participant row). Also acquires the per-user
   *   advisory lock when a transaction is supplied, so concurrent
   *   registrations for the same user can't both pass the balance check.
   * @returns {Promise<{success: boolean, newBalance: number}>}
   */
  async deductTournamentEntry(userId, entryFee, tournamentId, transaction = null) {
    if (transaction) {
      await this.lockUserWallet(userId, transaction);
    }

    // Read inside the caller's transaction. This previously called
    // getBalance(userId) with no transaction, which runs on a separate
    // connection outside the lock taken immediately above — so the lock
    // guarded nothing and two concurrent registrations could both pass this
    // check on the same funds.
    const currentBalance = await this.getBalance(userId, transaction);

    if (currentBalance < entryFee) {
      throw new Error('Insufficient balance for tournament entry');
    }

    const transactionRecord = await this.recordTransaction(
      userId,
      'tournament_entry',
      -entryFee,
      {
        tournamentId,
        description: `Tournament entry fee: ${entryFee} Chuta`
      },
      transaction
    );

    return {
      success: true,
      newBalance: parseFloat(transactionRecord.balanceAfter)
    };
  }

  /**
   * Award tournament prize
   * @param {number} userId - User ID
   * @param {number} prizeAmount - Prize in Chuta
   * @param {string} tournamentId - Tournament UUID
   * @param {number} placement - Final placement
   * @returns {Promise<{success: boolean, newBalance: number}>}
   */
  async awardTournamentPrize(userId, prizeAmount, tournamentId, placement) {
    const transaction = await this.recordTransaction(
      userId,
      'tournament_prize',
      prizeAmount,
      {
        tournamentId,
        placement,
        description: `Tournament prize (${placement}${this.getOrdinalSuffix(placement)} place): ${prizeAmount} Chuta`
      }
    );

    return {
      success: true,
      newBalance: parseFloat(transaction.balanceAfter)
    };
  }

  /**
   * Refund tournament entry fees
   * @param {string} tournamentId - Tournament UUID
   * @param {Array<{userId: number, entryFee: number}>} refunds - Array of refund objects
   * @returns {Promise<{success: boolean, refundCount: number, totalRefunded: number}>}
   */
  /**
   * @param {string} tournamentId
   * @param {Array<{userId: number, entryFee: number}>} refunds
   * @param {import('sequelize').Transaction} [externalTransaction] - Pass the
   *   caller's transaction to make the refund atomic with whatever else the
   *   caller does (e.g. destroying the participant row). If omitted, runs in
   *   its own transaction as before.
   */
  async refundTournamentEntries(tournamentId, refunds, externalTransaction = null) {
    let totalRefunded = 0;

    const run = async (t) => {
      for (const { userId, entryFee } of refunds) {
        await this.recordTransaction(
          userId,
          'tournament_refund',
          entryFee,
          {
            tournamentId,
            description: `Refunded tournament entry: ${entryFee} Chuta`
          },
          t
        );
        totalRefunded += entryFee;
      }
    };

    if (externalTransaction) {
      await run(externalTransaction);
    } else {
      await sequelize.transaction(run);
    }

    return {
      success: true,
      refundCount: refunds.length,
      totalRefunded
    };
  }

  /**
   * Admin balance adjustment
   * @param {number} userId - User ID
   * @param {number} amount - Amount to adjust (positive or negative)
   * @param {string} reason - Reason for adjustment
   * @param {number} adminId - Admin user ID
   * @returns {Promise<{success: boolean, newBalance: number, transactionId: string}>}
   */
  async adjustBalance(userId, amount, reason, adminId) {
    const transaction = await this.recordTransaction(
      userId,
      'admin_adjustment',
      amount,
      {
        adminId,
        reason,
        description: `Admin adjustment: ${amount > 0 ? '+' : ''}${amount} Chuta - ${reason}`
      }
    );

    return {
      success: true,
      newBalance: parseFloat(transaction.balanceAfter),
      transactionId: transaction.id
    };
  }

  /**
   * Verify user has sufficient balance
   * @param {number} userId - User ID
   * @param {number} requiredAmount - Required amount in Chuta
   * @returns {Promise<{sufficient: boolean, currentBalance: number, shortfall: number}>}
   */
  async verifyBalance(userId, requiredAmount) {
    const currentBalance = await this.getBalance(userId);
    const sufficient = currentBalance >= requiredAmount;
    const shortfall = sufficient ? 0 : requiredAmount - currentBalance;

    return {
      sufficient,
      currentBalance,
      shortfall
    };
  }

  /**
   * Record a transaction
   * @param {number} userId - User ID
   * @param {string} type - Transaction type
   * @param {number} amount - Amount in Chuta (positive for credit, negative for debit)
   * @param {Object} metadata - Additional transaction data
   * @param {Object} transaction - Sequelize transaction object (optional)
   * @returns {Promise<Object>} - Created transaction record
   */
  async recordTransaction(userId, type, amount, metadata = {}, transaction = null) {
    // Every ledger write is serialised per user by a transaction-scoped
    // advisory lock, so the read-compute-write below cannot interleave with a
    // concurrent write for the same user. Without this, two operations both
    // read the same balance and the second overwrote the first — losing a
    // debit while keeping a credit, which created money.
    //
    // When the caller supplies a transaction we join it (so the debit and
    // whatever else the caller is doing commit or roll back together, and any
    // lock the caller already took still applies — re-taking the same advisory
    // lock within one transaction is a no-op). Otherwise we open our own, so
    // even a bare call is atomic.
    const run = async (t) => {
      await this.lockUserWallet(userId, t);

      // Read inside the lock and inside this transaction, so it reflects any
      // uncommitted rows the caller has already written.
      const currentBalance = await this.getBalance(userId, t);
      const newBalance = currentBalance + amount;

      if (newBalance < 0) {
        throw new Error('Transaction would result in negative balance');
      }

      return ChutaCoinTransaction.create({
        userId,
        type,
        amount,
        balanceAfter: newBalance, // audit trail only — never trusted as a balance
        metadata,
        status: 'completed',
        description: metadata.description || null
      }, { transaction: t });
    };

    return transaction ? run(transaction) : sequelize.transaction(run);
  }

  /**
   * Get transaction history for a user
   * @param {number} userId - User ID
   * @param {Object} options - Query options (type, startDate, endDate, page, limit)
   * @returns {Promise<{transactions: Array, totalCount: number, page: number, totalPages: number}>}
   */
  async getTransactionHistory(userId, options = {}) {
    const { type, startDate, endDate, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const where = { userId };

    if (type) {
      where.type = type;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[sequelize.Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[sequelize.Op.lte] = new Date(endDate);
    }

    const { count, rows } = await ChutaCoinTransaction.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    return {
      transactions: rows,
      totalCount: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  /**
   * Get ordinal suffix for placement (1st, 2nd, 3rd, etc.)
   * @param {number} num - Number
   * @returns {string} - Ordinal suffix
   */
  getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  }
}

module.exports = new QuizWalletService();
