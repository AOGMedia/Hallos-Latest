'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('community_members', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      community_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'communities', key: 'id' },
        onDelete: 'CASCADE'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      role: {
        type: Sequelize.ENUM('owner', 'moderator', 'member'),
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('active', 'pending', 'banned'),
        allowNull: false,
        defaultValue: 'pending'
      },
      joined_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      invited_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' }
      },
      email_notifications_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addConstraint('community_members', {
      fields: ['community_id', 'user_id'],
      type: 'unique',
      name: 'uq_community_members_community_user'
    });

    await queryInterface.addIndex('community_members', ['community_id'], {
      name: 'idx_community_members_community_id'
    });
    await queryInterface.addIndex('community_members', ['user_id'], {
      name: 'idx_community_members_user_id'
    });
    await queryInterface.addIndex('community_members', ['community_id', 'status'], {
      name: 'idx_community_members_status'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('community_members');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_community_members_role";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_community_members_status";');
  }
};
