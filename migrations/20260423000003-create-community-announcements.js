'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('community_announcements', {
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
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
      },
      title: {
        type: Sequelize.STRING(300),
        allowNull: false
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      image_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      is_pinned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
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

    await queryInterface.addIndex('community_announcements', ['community_id'], {
      name: 'idx_community_announcements_community_id'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('community_announcements');
  }
};
