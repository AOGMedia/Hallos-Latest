const Wallet = require('../models/Wallet');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');
const { Op } = require('sequelize');
const databaseTransactionService = require('./databaseTransactionService');
const sequelize = require('../config/db');

// Initialize transaction service (singleton instance)
const transactionService = databaseTransactionService;

/**
 * Get or create wallet for a user (with multi-currency support)
 */
async function getOrCreateWallet(userId, currency = 'NGN') {
  try {
    // First check if new multi-currency wallet exists
    const WalletAccount = sequelize.models.WalletAccount;
    if (WalletAccount) {
      let walletAccount = await WalletAccount.findOne({ 
        where: { user_id: userId, currency } 
      });

      if (!walletAccount) {
        // Create new multi-currency wallet account
        walletAccount = await transactionService.executeWithTransaction(
          async (transaction) => {
            return await transactionService.createWalletInTransaction(
              userId, 
              currency, 
              transaction
            );
          },
          { operationType: 'create_wallet', userId }
        );
      }

      return {
        id: walletAccount.id,
        userId: walletAccount.user_id,
        currency: walletAccount.currency,
        totalEarnings: walletAccount.balance_available + walletAccount.balance_pending,
        withdrawnAmount: 0, // This would need to be calculated from transaction history
        pendingAmount: walletAccount.balance_pending,
        availableBalance: walletAccount.balance_available,
        getAvailableBalance: () => walletAccount.balance_available
      };
    }

    // Fallback to legacy wallet system
    let wallet = await Wallet.findOne({ where: { userId } });

    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        totalEarnings: 0,
        withdrawnAmount: 0,
        pendingAmount: 0,
        currency: currency
      });
    }

    return wallet;
  } catch (error) {
    console.error('Get or create wallet error:', error);
    throw error;
  }
}

/**
 * Add earnings to wallet (with transaction safety)
 */
async function addEarnings({ userId, amount, purchaseId, currency = 'NGN' }) {
  try {
    const amountInCents = Math.round(parseFloat(amount) * 100); // Convert to smallest currency unit

    // Use new transaction service for multi-currency wallets
    const WalletAccount = sequelize.models.WalletAccount;
    if (WalletAccount) {
      const result = await transactionService.executeWalletOperation(
        userId,
        currency,
        async (wallet, transaction) => {
          // Add earnings to available balance
          await transactionService.updateWalletBalance(
            wallet,
            amountInCents, // Credit available balance
            0, // No change to pending
            transaction
          );

          // Log the transaction
          const WalletTransaction = sequelize.models.WalletTransaction;
          if (WalletTransaction) {
            await WalletTransaction.create({
              wallet_account_id: wallet.id,
              transaction_type: 'credit',
              amount: amountInCents,
              balance_before: wallet.balance_available - amountInCents,
              balance_after: wallet.balance_available,
              reference: purchaseId ? `purchase_${purchaseId}` : null,
              description: 'Earnings from content purchase',
              metadata: { purchaseId, currency }
            }, { transaction });
          }

          return {
            id: wallet.id,
            userId: wallet.user_id,
            currency: wallet.currency,
            totalEarnings: wallet.balance_available + wallet.balance_pending,
            availableBalance: wallet.balance_available,
            pendingAmount: wallet.balance_pending
          };
        },
        { operationType: 'add_earnings' }
      );

      return result;
    }

    // Fallback to legacy system
    const wallet = await getOrCreateWallet(userId, currency);
    wallet.totalEarnings = parseFloat(wallet.totalEarnings) + parseFloat(amount);
    await wallet.save();

    return wallet;
  } catch (error) {
    console.error('Add earnings error:', error);
    throw error;
  }
}

/**
 * Get multi-currency wallet balances for a user
 */
async function getMultiCurrencyBalances(userId) {
  try {
    const WalletAccount = sequelize.models.WalletAccount;
    if (!WalletAccount) {
      // Fallback to single currency
      const balance = await getAvailableBalance(userId, 'NGN');
      return { NGN: balance };
    }

    const walletAccounts = await WalletAccount.findAll({
      where: { user_id: userId }
    });

    const balances = {};
    for (const account of walletAccounts) {
      // Convert from kobo/cents to naira/dollars
      const availableBalance = parseInt(account.balance_available) || 0;
      const pendingBalance = parseInt(account.balance_pending) || 0;
      const totalEarnings = availableBalance + pendingBalance;
      
      // Divide by 100 to convert kobo → naira or cents → dollars
      balances[account.currency] = {
        totalEarnings: (totalEarnings / 100).toFixed(2),
        withdrawnAmount: "0.00", // Would need calculation from transaction history
        pendingAmount: (pendingBalance / 100).toFixed(2),
        availableBalance: (availableBalance / 100).toFixed(2),
        currency: account.currency
      };
    }

    // Ensure both currencies exist (create if needed)
    if (!balances.NGN) {
      await getOrCreateWallet(userId, 'NGN');
      balances.NGN = await getAvailableBalance(userId, 'NGN');
    }
    if (!balances.USD) {
      await getOrCreateWallet(userId, 'USD');
      balances.USD = await getAvailableBalance(userId, 'USD');
    }

    return balances;
  } catch (error) {
    console.error('Get multi-currency balances error:', error);
    throw error;
  }
}

/**
 * Get available balance for a user (multi-currency support)
 */
async function getAvailableBalance(userId, currency = 'NGN') {
  try {
    // Try new multi-currency system first
    const WalletAccount = sequelize.models.WalletAccount;
    if (WalletAccount) {
      const walletAccount = await WalletAccount.findOne({ 
        where: { user_id: userId, currency } 
      });

      if (walletAccount) {
        // Convert from kobo/cents to naira/dollars
        const availableBalance = parseInt(walletAccount.balance_available) || 0;
        const pendingBalance = parseInt(walletAccount.balance_pending) || 0;
        const totalEarnings = availableBalance + pendingBalance;
        
        return {
          totalEarnings: (totalEarnings / 100).toFixed(2),
          withdrawnAmount: "0.00", // Would need to be calculated from transaction history
          pendingAmount: (pendingBalance / 100).toFixed(2),
          availableBalance: (availableBalance / 100).toFixed(2),
          currency: walletAccount.currency
        };
      }
    }

    // Fallback to legacy system
    const wallet = await getOrCreateWallet(userId, currency);
    
    const availableBalance = parseFloat(wallet.totalEarnings) - 
                            parseFloat(wallet.withdrawnAmount) - 
                            parseFloat(wallet.pendingAmount);

    return {
      totalEarnings: parseFloat(wallet.totalEarnings).toFixed(2),
      withdrawnAmount: parseFloat(wallet.withdrawnAmount).toFixed(2),
      pendingAmount: parseFloat(wallet.pendingAmount).toFixed(2),
      availableBalance: availableBalance.toFixed(2),
      currency: wallet.currency
    };
  } catch (error) {
    console.error('Get available balance error:', error);
    throw error;
  }
}

/**
 * Get earnings breakdown for a creator (updated for multi-currency)
 */
async function getEarningsBreakdown(userId) {
  try {
    // Get multi-currency balances
    const balances = await getMultiCurrencyBalances(userId);

    // Get all purchases for creator's content
    const videoPurchases = await Purchase.findAll({
      where: {
        contentType: 'video',
        paymentStatus: 'completed'
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ]
    });

    const liveClassPurchases = await Purchase.findAll({
      where: {
        contentType: 'live_class',
        paymentStatus: 'completed'
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ]
    });

    // Filter purchases for creator's content
    const creatorVideoPurchases = [];
    for (const purchase of videoPurchases) {
      const video = await Video.findByPk(purchase.contentId);
      if (video && video.userId === userId) {
        creatorVideoPurchases.push({
          ...purchase.toJSON(),
          contentTitle: video.title,
          contentType: 'video'
        });
      }
    }

    const creatorLiveClassPurchases = [];
    for (const purchase of liveClassPurchases) {
      const liveClass = await LiveClass.findByPk(purchase.contentId);
      if (liveClass && liveClass.userId === userId) {
        creatorLiveClassPurchases.push({
          ...purchase.toJSON(),
          contentTitle: liveClass.title,
          contentType: 'live_class'
        });
      }
    }

    const allPurchases = [...creatorVideoPurchases, ...creatorLiveClassPurchases];

    // Calculate totals by currency
    const totalsByCurrency = {};
    allPurchases.forEach(purchase => {
      const currency = purchase.currency || 'NGN';
      if (!totalsByCurrency[currency]) {
        totalsByCurrency[currency] = {
          totalFromVideos: 0,
          totalFromLiveClasses: 0,
          totalFromLiveSeries: 0,
          totalSales: 0,
          videoSales: 0,
          liveClassSales: 0,
          liveSeriesSales: 0
        };
      }

      const amount = parseFloat(purchase.amount);
      totalsByCurrency[currency].totalSales++;
      
      if (purchase.contentType === 'video') {
        totalsByCurrency[currency].totalFromVideos += amount;
        totalsByCurrency[currency].videoSales++;
      } else if (purchase.contentType === 'live_class') {
        totalsByCurrency[currency].totalFromLiveClasses += amount;
        totalsByCurrency[currency].liveClassSales++;
      } else if (purchase.contentType === 'live_series') {
        totalsByCurrency[currency].totalFromLiveSeries += amount;
        totalsByCurrency[currency].liveSeriesSales++;
      }
    });

    return {
      wallets: balances,
      breakdown: totalsByCurrency,
      recentSales: allPurchases.slice(0, 10) // Last 10 sales
    };
  } catch (error) {
    console.error('Get earnings breakdown error:', error);
    throw error;
  }
}

/**
 * Get list of students who purchased creator's content
 */
async function getCreatorPurchases(userId, { limit = 50, offset = 0, contentType = null } = {}) {
  try {
    // Get all creator's videos
    const videos = await Video.findAll({
      where: { userId },
      attributes: ['id', 'title', 'price', 'type']
    });

    // Get all creator's live classes
    const liveClasses = await LiveClass.findAll({
      where: { userId },
      attributes: ['id', 'title', 'price', 'startTime']
    });

    const videoIds = videos.map(v => v.id);
    const liveClassIds = liveClasses.map(lc => lc.id);

    // Build query filters
    const whereClause = {
      paymentStatus: 'completed',
      [Op.or]: [
        {
          contentType: 'video',
          contentId: { [Op.in]: videoIds }
        },
        {
          contentType: 'live_class',
          contentId: { [Op.in]: liveClassIds }
        }
      ]
    };

    // Filter by content type if specified
    if (contentType && ['video', 'live_class', 'live_series'].includes(contentType)) {
      if (contentType === 'video') {
        whereClause[Op.or] = [{ contentType: 'video', contentId: { [Op.in]: videoIds } }];
      } else {
        whereClause[Op.or] = [{ contentType: 'live_class', contentId: { [Op.in]: liveClassIds } }];
      }
    }

    // Get purchases
    const purchases = await Purchase.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    // Enrich with content details
    const enrichedPurchases = await Promise.all(
      purchases.rows.map(async (purchase) => {
        const purchaseData = purchase.toJSON();
        
        if (purchase.contentType === 'video') {
          const video = videos.find(v => v.id === purchase.contentId);
          purchaseData.content = video ? video.toJSON() : null;
        } else if (purchase.contentType === 'live_class') {
          const liveClass = liveClasses.find(lc => lc.id === purchase.contentId);
          purchaseData.content = liveClass ? liveClass.toJSON() : null;
        } else if (purchase.contentType === 'live_series') {
          const { LiveSeries } = require('../models/liveSeriesIndex');
          const liveSeries = await LiveSeries.findByPk(purchase.contentId, {
            attributes: ['id', 'title', 'thumbnailUrl', 'startDate', 'endDate', 'status']
          });
          purchaseData.content = liveSeries ? liveSeries.toJSON() : null;
        }
        
        return purchaseData;
      })
    );

    return {
      total: purchases.count,
      purchases: enrichedPurchases,
      limit,
      offset
    };
  } catch (error) {
    console.error('Get creator purchases error:', error);
    throw error;
  }
}

/**
 * Lock amount in wallet for pending withdrawal (with transaction safety)
 */
async function lockAmountForWithdrawal(userId, amount, currency = 'NGN') {
  try {
    const amountInCents = Math.round(parseFloat(amount) * 100);

    // Use new transaction service for multi-currency wallets
    const WalletAccount = sequelize.models.WalletAccount;
    if (WalletAccount) {
      const result = await transactionService.executeWalletOperation(
        userId,
        currency,
        async (wallet, transaction) => {
          // Move amount from available to pending
          await transactionService.updateWalletBalance(
            wallet,
            -amountInCents, // Debit available balance
            amountInCents,  // Credit pending balance
            transaction
          );

          // Log the transaction
          const WalletTransaction = sequelize.models.WalletTransaction;
          if (WalletTransaction) {
            await WalletTransaction.create({
              wallet_account_id: wallet.id,
              transaction_type: 'transfer_out',
              amount: amountInCents,
              balance_before: wallet.balance_available + amountInCents,
              balance_after: wallet.balance_available,
              currency: currency,
              reference: `lock_withdrawal_${userId}_${Date.now()}`,
              idempotency_key: require('crypto').randomUUID(),
              description: 'Amount locked for withdrawal',
              metadata: { currency, operation: 'lock_for_withdrawal' }
            }, { transaction });
          }

          return {
            id: wallet.id,
            userId: wallet.user_id,
            currency: wallet.currency,
            availableBalance: wallet.balance_available,
            pendingAmount: wallet.balance_pending
          };
        },
        { operationType: 'lock_withdrawal' }
      );

      return result;
    }

    // Fallback to legacy system
    const wallet = await getOrCreateWallet(userId, currency);

    const availableBalance = wallet.getAvailableBalance();
    
    if (availableBalance < amount) {
      throw new Error('Insufficient balance');
    }

    wallet.pendingAmount = parseFloat(wallet.pendingAmount) + parseFloat(amount);
    await wallet.save();

    return wallet;
  } catch (error) {
    console.error('Lock amount error:', error);
    throw error;
  }
}

/**
 * Release locked amount (if withdrawal fails) - with transaction safety
 */
async function releaseLockedAmount(userId, amount, currency = 'NGN') {
  try {
    const amountInCents = Math.round(parseFloat(amount) * 100);

    // Use new transaction service for multi-currency wallets
    const WalletAccount = sequelize.models.WalletAccount;
    if (WalletAccount) {
      const result = await transactionService.executeWalletOperation(
        userId,
        currency,
        async (wallet, transaction) => {
          // Move amount from pending back to available
          await transactionService.updateWalletBalance(
            wallet,
            amountInCents,  // Credit available balance
            -amountInCents, // Debit pending balance
            transaction
          );

          // Log the transaction
          const WalletTransaction = sequelize.models.WalletTransaction;
          if (WalletTransaction) {
            await WalletTransaction.create({
              wallet_account_id: wallet.id,
              transaction_type: 'transfer_in',
              amount: amountInCents,
              balance_before: wallet.balance_available - amountInCents,
              balance_after: wallet.balance_available,
              description: 'Released locked amount (withdrawal failed)',
              metadata: { currency, operation: 'release_locked_amount' }
            }, { transaction });
          }

          return {
            id: wallet.id,
            userId: wallet.user_id,
            currency: wallet.currency,
            availableBalance: wallet.balance_available,
            pendingAmount: wallet.balance_pending
          };
        },
        { operationType: 'release_locked' }
      );

      return result;
    }

    // Fallback to legacy system
    const wallet = await getOrCreateWallet(userId, currency);

    wallet.pendingAmount = parseFloat(wallet.pendingAmount) - parseFloat(amount);
    await wallet.save();

    return wallet;
  } catch (error) {
    console.error('Release locked amount error:', error);
    throw error;
  }
}

/**
 * Complete withdrawal (move from pending to withdrawn) - with transaction safety
 */
async function completeWithdrawal(userId, amount, currency = 'NGN') {
  try {
    const amountInCents = Math.round(parseFloat(amount) * 100);

    // Use new transaction service for multi-currency wallets
    const WalletAccount = sequelize.models.WalletAccount;
    if (WalletAccount) {
      const result = await transactionService.executeWalletOperation(
        userId,
        currency,
        async (wallet, transaction) => {
          // Remove amount from pending balance (it's already been withdrawn)
          await transactionService.updateWalletBalance(
            wallet,
            0,              // No change to available balance
            -amountInCents, // Debit pending balance
            transaction
          );

          // Log the transaction
          const WalletTransaction = sequelize.models.WalletTransaction;
          if (WalletTransaction) {
            await WalletTransaction.create({
              wallet_account_id: wallet.id,
              transaction_type: 'debit',
              amount: amountInCents,
              balance_before: wallet.balance_pending + amountInCents,
              balance_after: wallet.balance_pending,
              description: 'Withdrawal completed',
              metadata: { currency, operation: 'complete_withdrawal' }
            }, { transaction });
          }

          return {
            id: wallet.id,
            userId: wallet.user_id,
            currency: wallet.currency,
            availableBalance: wallet.balance_available,
            pendingAmount: wallet.balance_pending
          };
        },
        { operationType: 'complete_withdrawal' }
      );

      return result;
    }

    // Fallback to legacy system
    const wallet = await getOrCreateWallet(userId, currency);

    wallet.withdrawnAmount = parseFloat(wallet.withdrawnAmount) + parseFloat(amount);
    wallet.pendingAmount = parseFloat(wallet.pendingAmount) - parseFloat(amount);
    await wallet.save();

    return wallet;
  } catch (error) {
    console.error('Complete withdrawal error:', error); 
    throw error;
  }
}

module.exports = {
  getOrCreateWallet,
  addEarnings,
  getAvailableBalance,
  getMultiCurrencyBalances,
  getEarningsBreakdown,
  getCreatorPurchases,
  lockAmountForWithdrawal,
  releaseLockedAmount,
  completeWithdrawal
};
