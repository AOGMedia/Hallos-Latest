const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizInviteClaim Model
 *
 * One row per person who used a QuizInvite link. Mirrors the
 * ReferralCode -> UserReferral split already used for partner referrals:
 * the invite is the reusable link, the claim is a specific person's use
 * of it.
 */
const QuizInviteClaim = sequelize.define('QuizInviteClaim', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  inviteId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'invite_id',
    references: { model: 'quiz_invites', key: 'id' }
  },
  inviteeUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'invitee_user_id',
    references: { model: 'Users', key: 'id' }
  },
  outcome: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: { isIn: [['matched', 'pending_notify', 'self_blocked', 'expired', 'revoked']] }
  },
  matchId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'match_id',
    references: { model: 'quiz_matches', key: 'id' }
  },
  claimIp: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'claim_ip'
  },
  suspiciousSameIp: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'suspicious_same_ip'
  },
  inviterNotifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'inviter_notified_at'
  }
}, {
  tableName: 'quiz_invite_claims',
  underscored: true,
  createdAt: 'created_at',
  updatedAt: false
});

QuizInviteClaim.associate = (models) => {
  QuizInviteClaim.belongsTo(models.QuizInvite, { foreignKey: 'inviteId', as: 'invite' });
  QuizInviteClaim.belongsTo(models.User, { foreignKey: 'inviteeUserId', as: 'invitee' });
  QuizInviteClaim.belongsTo(models.QuizMatch, { foreignKey: 'matchId', as: 'match' });
};

module.exports = QuizInviteClaim;
