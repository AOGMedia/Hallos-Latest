const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ReferralCode = sequelize.define('ReferralCode', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  referralCode: {
    type: DataTypes.STRING(20),
    unique: true,
    allowNull: false,
    field: 'referral_code'
  },
  label: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: 'Human-readable name e.g. "Nigerian Teachers Association Q1 2026"'
  },
  partnerUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'partner_user_id',
    references: { model: 'Users', key: 'id' }
  },
  commissionPercent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    field: 'commission_percent',
    validate: { min: 0.01, max: 99.99 }
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'expires_at'
  },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [['active', 'inactive', 'expired']] }
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'created_by',
    references: { model: 'Users', key: 'id' }
  },
  clicksCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    field: 'clicks_count'
  },
  successfulReferrals: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    field: 'successful_referrals'
  },
  totalEarnings: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    allowNull: false,
    field: 'total_earnings'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  lastUsedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_used_at'
  }
}, {
  tableName: 'referral_codes',
  timestamps: false
});

ReferralCode.associate = (models) => {
  ReferralCode.belongsTo(models.User, { foreignKey: 'partnerUserId', as: 'partner', constraints: false });
  ReferralCode.belongsTo(models.User, { foreignKey: 'createdBy', as: 'createdByUser', constraints: false });
  ReferralCode.hasMany(models.UserReferral, { foreignKey: 'referralCodeId', as: 'userReferrals' });
  ReferralCode.hasMany(models.ReferralCommission, {
    foreignKey: 'referralCode',
    sourceKey: 'referralCode',
    as: 'commissions'
  });
};

module.exports = ReferralCode;
