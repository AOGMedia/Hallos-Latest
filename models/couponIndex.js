const Coupon = require('./Coupon');
const CouponUsage = require('./CouponUsage');
const CouponAuditLog = require('./CouponAuditLog');
const User = require('./User');
const Purchase = require('./Purchase');

// Coupon associations
Coupon.hasMany(CouponUsage, {
  foreignKey: 'couponId',
  as: 'usageRecords'
});

Coupon.hasMany(CouponAuditLog, {
  foreignKey: 'couponId',
  as: 'auditLogs'
});

Coupon.belongsTo(User, {
  foreignKey: 'creatorId',
  as: 'creator'
});

Coupon.belongsTo(User, {
  foreignKey: 'partnerUserId',
  as: 'partner'
});

// CouponUsage associations
CouponUsage.belongsTo(Coupon, {
  foreignKey: 'couponId',
  as: 'coupon'
});

CouponUsage.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

CouponUsage.belongsTo(Purchase, {
  foreignKey: 'purchaseId',
  as: 'purchase'
});

// CouponAuditLog associations
CouponAuditLog.belongsTo(Coupon, {
  foreignKey: 'couponId',
  as: 'coupon'
});

CouponAuditLog.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// Purchase association
Purchase.belongsTo(Coupon, {
  foreignKey: 'couponId',
  as: 'coupon'
});

module.exports = {
  Coupon,
  CouponUsage,
  CouponAuditLog
};
