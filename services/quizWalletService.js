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
   * Get user's Chuta balance
   * @param {number} userId - User ID
   * @returns {Promise<number>} - Balance in Chuta
   */
  async getBalance(userId) {
    // Get the most recent transaction to get current balance
    const lastTransaction = await ChutaCoinTransaction.findOne({
      where: { userId },
      order: [['createdAt', 'DESC']]
    });

    return lastTransaction ? parseFloat(lastTransaction.balanceAfter) : 0;
  }

  /**
   * Credit initial bonus to new user (idempotent)
   * @param {number} userId - User ID
   * @param {string} nickname - Quiz platform nickname
   * @param {string} avatarUrl - DiceBear avatar URL
   * @returns {Promise<{success: boolean, balance: number, transaction: Object}>}
   */
  async creditInitialBonus(userId, nickname, avatarUrl) {
    // Check if user already received initial bonus
    const existingBonus = await ChutaCoinTransaction.findOne({
      where: {
        userId,
        type: 'initial_bonus'
      }
    });

    if (existingBonus) {
      const currentBalance = await this.getBalance(userId);
      return {
        success: false,
        message: 'Initial bonus already credited',
        balance: currentBalance,
        transaction: null
      };
    }

    // Check nickname uniqueness
    const existingNickname = await UserQuizStats.findOne({ where: { nickname } });
    if (existingNickname) {
      throw new Error('Nickname already taken. Please choose a different one.');
    }

    // Credit the bonus
    const transaction = await this.recordTransaction(
      userId,
      'initial_bonus',
      QuizWalletService.INITIAL_BONUS,
      { description: 'Welcome bonus' }
    );

    // Initialize user quiz stats with nickname and avatar
    await UserQuizStats.findOrCreate({
      where: { userId },
      defaults: { userId, nickname, avatarUrl }
    });

    // If stats already existed (edge case), update nickname/avatar
    await UserQuizStats.update(
      { nickname, avatarUrl },
      { where: { userId, nickname: null } }
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

    const currentBalance = await this.getBalance(userId);

    // Validate minimum withdrawal
    if (chutaAmount < QuizWalletService.MIN_WITHDRAWAL) {
      throw new Error(`Minimum withdrawal is ${QuizWalletService.MIN_WITHDRAWAL} Chuta ($${this.chutaToUsd(QuizWalletService.MIN_WITHDRAWAL)})`);
    }

    // Validate sufficient balance
    if (currentBalance < chutaAmount) {
      throw new Error('Insufficient balance');
    }

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
    const currentBalance = await this.getBalance(userId);

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
      }
    );

    return {
      success: true,
      escrowedAmount: amount,
      newBalance: parseFloat(transaction.balanceAfter)
    };
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
   * Release escrowed funds to the winner
   * @param {string} matchId - Match UUID
   * @param {number|string} winnerId - Winner's user ID
   * @param {number} amount - Total escrow amount
   */
  async releaseEscrow(matchId, winnerId, amount) {
    await this.recordTransaction(
      winnerId,
      'match_win',
      amount,
      {
        matchId,
        description: `Won match prize: ${amount} Chuta`
      }
    );

    return { success: true };
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
   * Deduct tournament entry fee
   * @param {number} userId - User ID
   * @param {number} entryFee - Entry fee in Chuta
   * @param {string} tournamentId - Tournament UUID
   * @returns {Promise<{success: boolean, newBalance: number}>}
   */
  async deductTournamentEntry(userId, entryFee, tournamentId) {
    const currentBalance = await this.getBalance(userId);

    if (currentBalance < entryFee) {
      throw new Error('Insufficient balance for tournament entry');
    }

    const transaction = await this.recordTransaction(
      userId,
      'tournament_entry',
      -entryFee,
      {
        tournamentId,
        description: `Tournament entry fee: ${entryFee} Chuta`
      }
    );

    return {
      success: true,
      newBalance: parseFloat(transaction.balanceAfter)
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
  async refundTournamentEntries(tournamentId, refunds) {
    let totalRefunded = 0;

    await sequelize.transaction(async (t) => {
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
    });

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
    const currentBalance = await this.getBalance(userId);
    const newBalance = currentBalance + amount;

    if (newBalance < 0) {
      throw new Error('Transaction would result in negative balance');
    }

    const txRecord = await ChutaCoinTransaction.create({
      userId,
      type,
      amount,
      balanceAfter: newBalance,
      metadata,
      status: 'completed',
      description: metadata.description || null
    }, { transaction });

    return txRecord;
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
