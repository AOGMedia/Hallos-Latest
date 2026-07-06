const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ReferralCommission = sequelize.define('ReferralCommission', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  referralCode: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'referral_code'
  },
  referrerUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'referrer_user_id',
    references: { model: 'Users', key: 'id' }
  },
  refereeUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'referee_user_id',
    references: { model: 'Users', key: 'id' }
  },
  purchaseId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    field: 'purchase_id',
    references: { model: 'purchases', key: 'id' }
  },
  commissionAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'commission_amount'
  },
  commissionPercent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    field: 'commission_percent',
    comment: 'Rate at time of commission'
  },
  purchaseAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'purchase_amount'
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false
  },
  contentType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'content_type'
  },
  contentId: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'content_id'
  },
  purchasedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'purchased_at'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'referral_commissions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

ReferralCommission.associate = (models) => {
  ReferralCommission.belongsTo(models.User, { foreignKey: 'referrerUserId', as: 'referrer' });
  ReferralCommission.belongsTo(models.User, { foreignKey: 'refereeUserId', as: 'referee' });
  ReferralCommission.belongsTo(models.Purchase, { foreignKey: 'purchaseId', as: 'purchase' });
};

module.exports = ReferralCommission;
