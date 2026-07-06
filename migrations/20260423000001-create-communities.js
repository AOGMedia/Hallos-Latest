'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('communities', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(200),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      thumbnail_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      cover_image_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      type: {
        type: Sequelize.ENUM('school', 'association', 'committee', 'general'),
        allowNull: false
      },
      visibility: {
        type: Sequelize.ENUM('public', 'private'),
        allowNull: false
      },
      join_policy: {
        type: Sequelize.ENUM('request', 'invite_only'),
        allowNull: false,
        defaultValue: 'request'
      },
      status: {
        type: Sequelize.ENUM('pending', 'active', 'suspended', 'rejected'),
        allowNull: false,
        defaultValue: 'pending'
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
      },
      invite_token: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true
      },
      member_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
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

    await queryInterface.addIndex('communities', ['status', 'visibility'], {
      name: 'idx_communities_status_visibility'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('communities');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_communities_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_communities_visibility";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_communities_join_policy";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_communities_status";');
  }
};
