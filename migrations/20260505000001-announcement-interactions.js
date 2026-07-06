'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add liked_by JSONB array to community_announcements
    await queryInterface.addColumn('community_announcements', 'liked_by', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });

    // Create announcement comments table
    await queryInterface.createTable('community_announcement_comments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      announcement_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'community_announcements', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      community_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'communities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: false
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

    await queryInterface.addIndex('community_announcement_comments', ['announcement_id'], {
      name: 'idx_announcement_comments_announcement_id'
    });
    await queryInterface.addIndex('community_announcement_comments', ['user_id'], {
      name: 'idx_announcement_comments_user_id'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('community_announcement_comments');
    await queryInterface.removeColumn('community_announcements', 'liked_by');
  }
};
