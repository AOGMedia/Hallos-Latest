const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const UserReferral = sequelize.define('UserReferral', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  creatorUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    field: 'creator_user_id',
    references: { model: 'Users', key: 'id' }
  },
  referralCodeId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'referral_code_id',
    references: { model: 'referral_codes', key: 'id' }
  },
  referralCode: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'referral_code',
    comment: 'Denormalized for quick lookup'
  },
  partnerUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'partner_user_id',
    references: { model: 'Users', key: 'id' }
  },
  signedUpAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'signed_up_at'
  },
  commissionActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'commission_active',
    comment: 'Set to false when referral code expires or is deactivated'
  }
}, {
  tableName: 'user_referrals',
  timestamps: false
});

UserReferral.associate = (models) => {
  UserReferral.belongsTo(models.User, { foreignKey: 'creatorUserId', as: 'creator' });
  UserReferral.belongsTo(models.User, { foreignKey: 'partnerUserId', as: 'partner' });
  UserReferral.belongsTo(models.ReferralCode, { foreignKey: 'referralCodeId', as: 'code' });
};

module.exports = UserReferral;
