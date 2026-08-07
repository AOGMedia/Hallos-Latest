'use strict';

/**
 * Migration: Create Quiz Invite Claims Table
 *
 * One row per person who used an invite link (mirrors the
 * ReferralCode -> UserReferral pattern already used for partner
 * referrals). A single QuizInvite can be claimed by many different
 * invitees (e.g. a link shared in a group chat), but each invitee can
 * only claim a given invite once.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('quiz_invite_claims', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      invite_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'quiz_invites', key: 'id' },
        onDelete: 'CASCADE'
      },
      invitee_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      outcome: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'matched | pending_notify | self_blocked | expired | revoked'
      },
      match_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'quiz_matches', key: 'id' }
      },
      claim_ip: {
        type: Sequelize.STRING,
        allowNull: true
      },
      suspicious_same_ip: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      inviter_notified_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('quiz_invite_claims', ['invite_id', 'invitee_user_id'], {
      name: 'idx_quiz_invite_claims_unique_per_invitee',
      unique: true
    });

    await queryInterface.addIndex('quiz_invite_claims', ['invitee_user_id'], {
      name: 'idx_quiz_invite_claims_invitee'
    });

    // Fast lookup for "flush pending notifications for this inviter" on connect
    await queryInterface.addIndex('quiz_invite_claims', ['outcome', 'inviter_notified_at'], {
      name: 'idx_quiz_invite_claims_pending_notify'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quiz_invite_claims');
  }
};
