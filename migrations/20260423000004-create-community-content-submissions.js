'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('community_content_submissions', {
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
      submitted_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
      },
      content_type: {
        type: Sequelize.ENUM('live_class', 'live_series', 'video', 'freebie'),
        allowNull: false
      },
      content_data: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'resubmitted'),
        allowNull: false,
        defaultValue: 'pending'
      },
      rejection_reason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      reviewed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' }
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      community_visibility: {
        type: Sequelize.ENUM('community_only', 'public'),
        allowNull: false,
        defaultValue: 'community_only'
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

    await queryInterface.addIndex('community_content_submissions', ['community_id'], {
      name: 'idx_community_content_submissions_community_id'
    });
    await queryInterface.addIndex('community_content_submissions', ['community_id', 'status'], {
      name: 'idx_community_content_submissions_status'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('community_content_submissions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_community_content_submissions_content_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_community_content_submissions_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_community_content_submissions_community_visibility";');
  }
};
