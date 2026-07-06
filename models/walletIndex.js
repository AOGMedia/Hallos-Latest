const User = require('./User');
const Purchase = require('./Purchase');
const Wallet = require('./Wallet');
const WalletAccount = require('./WalletAccount');
const WalletTransaction = require('./WalletTransaction');
const Payout = require('./Payout');
const Transaction = require('./Transaction');
const Video = require('./Video');
const LiveClass = require('./liveClass');

// User associations
User.hasMany(Purchase, { foreignKey: 'userId', as: 'purchases' });
User.hasOne(Wallet, { foreignKey: 'userId', as: 'wallet' });
User.hasMany(WalletAccount, { foreignKey: 'user_id', as: 'walletAccounts' });
User.hasMany(Payout, { foreignKey: 'userId', as: 'payouts' });
User.hasMany(Transaction, { foreignKey: 'userId', as: 'transactions' });

// Purchase associations
Purchase.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Wallet associations
Wallet.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// WalletAccount associations
WalletAccount.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
WalletAccount.hasMany(WalletTransaction, { foreignKey: 'wallet_account_id', as: 'transactions' });

// WalletTransaction associations
WalletTransaction.belongsTo(WalletAccount, { foreignKey: 'wallet_account_id', as: 'walletAccount' });

// Payout associations
Payout.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Transaction associations
Transaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Video associations (for purchases)
Video.hasMany(Purchase, { 
  foreignKey: 'contentId',
  constraints: false,
  scope: {
    contentType: 'video'
  },
  as: 'purchases'
});

// LiveClass associations (for purchases)
LiveClass.hasMany(Purchase, { 
  foreignKey: 'contentId',
  constraints: false,
  scope: {
    contentType: 'live_class'
  },
  as: 'purchases'
});

module.exports = {
  User,
  Purchase,
  Wallet,
  WalletAccount,
  WalletTransaction,
  Payout,
  Transaction,
  Video,
  LiveClass
};
