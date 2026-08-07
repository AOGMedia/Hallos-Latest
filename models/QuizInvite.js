const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizInvite Model
 *
 * A shareable, tokenized "invite a friend to play" link. Persisted and
 * trackable — unlike the legacy `?invite={userId}` scheme, this survives
 * an async signup/login detour and can carry a preferred wager + category
 * so the invitee can be auto-matched with the inviter once both are ready.
 */
const QuizInvite = sequelize.define('QuizInvite', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  token: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true
  },
  inviterUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'inviter_user_id',
    references: { model: 'Users', key: 'id' }
  },
  channel: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'link',
    validate: { isIn: [['email', 'sms', 'whatsapp', 'link']] }
  },
  toEmail: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'to_email'
  },
  toPhone: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'to_phone'
  },
  wagerAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'wager_amount'
  },
  categoryId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'category_id',
    references: { model: 'quiz_categories', key: 'id' }
  },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [['active', 'revoked', 'expired']] }
  },
  isStanding: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_standing'
  },
  creatorIp: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'creator_ip'
  },
  clicksCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'clicks_count'
  },
  claimsCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'claims_count'
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'expires_at'
  }
}, {
  tableName: 'quiz_invites',
  underscored: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

QuizInvite.associate = (models) => {
  QuizInvite.belongsTo(models.User, { foreignKey: 'inviterUserId', as: 'inviter' });
  QuizInvite.belongsTo(models.QuizCategory, { foreignKey: 'categoryId', as: 'category' });
  QuizInvite.hasMany(models.QuizInviteClaim, { foreignKey: 'inviteId', as: 'claims' });
};

module.exports = QuizInvite;
