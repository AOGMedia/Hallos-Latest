'use strict';

/**
 * Migration: Create Quiz Invites Table
 *
 * A shareable, tokenized "invite a friend" link. Unlike the old raw
 * `?invite={userId}` scheme, this is a persisted, trackable, expiring
 * token that can carry a preferred wager/category and can be resolved
 * and claimed independently of how the invitee authenticates
 * (signup, login, or OAuth).
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    );

    await queryInterface.createTable('quiz_invites', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      token: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true
      },
      inviter_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      channel: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'link'
      },
      to_email: {
        type: Sequelize.STRING,
        allowNull: true
      },
      to_phone: {
        type: Sequelize.STRING,
        allowNull: true
      },
      wager_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
      },
      category_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'quiz_categories', key: 'id' }
      },
      status: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'active'
      },
      is_standing: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'True for the reusable generic share-link created by the passive "no players online" CTAs'
      },
      creator_ip: {
        type: Sequelize.STRING,
        allowNull: true
      },
      clicks_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      claims_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('quiz_invites', ['token'], {
      name: 'idx_quiz_invites_token',
      unique: true
    });

    await queryInterface.addIndex('quiz_invites', ['inviter_user_id', 'status'], {
      name: 'idx_quiz_invites_inviter_status'
    });

    await queryInterface.addIndex('quiz_invites', ['inviter_user_id', 'is_standing'], {
      name: 'idx_quiz_invites_inviter_standing'
    });

    // At most one reusable "standing" share-link per inviter, so passive
    // CTAs (lobby/status, lobby/players) don't spawn a new row per poll.
    await queryInterface.addIndex('quiz_invites', ['inviter_user_id'], {
      name: 'idx_quiz_invites_one_standing_per_user',
      unique: true,
      where: { is_standing: true }
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quiz_invites');
  }
};
