/**
 * Referral Models Index
 * Sets up associations for the revamped referral system.
 */

const ReferralCode = require('./ReferralCode');
const ReferralCommission = require('./ReferralCommission');
const UserReferral = require('./UserReferral');
const User = require('./User');
const Purchase = require('./Purchase');

// ReferralCode associations
ReferralCode.belongsTo(User, { foreignKey: 'partnerUserId', as: 'partner', constraints: false });
ReferralCode.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser', constraints: false });
ReferralCode.hasMany(UserReferral, { foreignKey: 'referralCodeId', as: 'userReferrals' });
ReferralCode.hasMany(ReferralCommission, {
  foreignKey: 'referralCode',
  sourceKey: 'referralCode',
  as: 'commissions'
});

// UserReferral associations
UserReferral.belongsTo(User, { foreignKey: 'creatorUserId', as: 'creator', constraints: false });
UserReferral.belongsTo(User, { foreignKey: 'partnerUserId', as: 'partner', constraints: false });
UserReferral.belongsTo(ReferralCode, { foreignKey: 'referralCodeId', as: 'code' });

// ReferralCommission associations
ReferralCommission.belongsTo(User, { foreignKey: 'referrerUserId', as: 'referrer', constraints: false });
ReferralCommission.belongsTo(User, { foreignKey: 'refereeUserId', as: 'referee', constraints: false });
ReferralCommission.belongsTo(Purchase, { foreignKey: 'purchaseId', as: 'purchase' });

// User reverse associations
User.hasMany(ReferralCode, { foreignKey: 'partnerUserId', as: 'referralCodes', constraints: false });
User.hasMany(UserReferral, { foreignKey: 'creatorUserId', as: 'userReferral', constraints: false });
User.hasMany(ReferralCommission, { foreignKey: 'referrerUserId', as: 'referralsMade', constraints: false });
User.hasMany(ReferralCommission, { foreignKey: 'refereeUserId', as: 'referralsReceived', constraints: false });

module.exports = { ReferralCode, ReferralCommission, UserReferral };
