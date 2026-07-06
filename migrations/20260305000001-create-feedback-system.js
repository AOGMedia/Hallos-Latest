'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create feedback table
    await queryInterface.createTable('feedback', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      user_type: {
        type: Sequelize.ENUM('creator', 'learner', 'educator'),
        allowNull: false,
        comment: 'Type of user submitting feedback'
      },
      rating: {
        type: Sequelize.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5
        },
        comment: 'Rating from 1 to 5 stars'
      },
      category: {
        type: Sequelize.ENUM('bug', 'feature_request', 'improvement', 'general', 'complaint', 'praise'),
        allowNull: false,
        defaultValue: 'general',
        comment: 'Category of feedback'
      },
      subject: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Brief subject/title of feedback'
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Detailed feedback message'
      },
      status: {
        type: Sequelize.ENUM('new', 'reviewed', 'in_progress', 'resolved', 'dismissed'),
        allowNull: false,
        defaultValue: 'new',
        comment: 'Status of feedback for admin tracking'
      },
      admin_notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Internal notes from admin'
      },
      reviewed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Admin user who reviewed this feedback'
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'When feedback was reviewed'
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

    // Add indexes for performance
    await queryInterface.addIndex('feedback', ['user_id'], {
      name: 'idx_feedback_user_id'
    });

    await queryInterface.addIndex('feedback', ['status'], {
      name: 'idx_feedback_status'
    });

    await queryInterface.addIndex('feedback', ['rating'], {
      name: 'idx_feedback_rating'
    });

    await queryInterface.addIndex('feedback', ['user_type'], {
      name: 'idx_feedback_user_type'
    });

    await queryInterface.addIndex('feedback', ['category'], {
      name: 'idx_feedback_category'
    });

    await queryInterface.addIndex('feedback', ['created_at'], {
      name: 'idx_feedback_created_at'
    });

    // Add feedback_submitted field to Users table
    await queryInterface.addColumn('Users', 'feedback_submitted', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Track if user has submitted feedback (for popup logic)'
    });

    // Add feedback_dismissed_at field to Users table
    await queryInterface.addColumn('Users', 'feedback_dismissed_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'When user dismissed feedback popup'
    });

    console.log('✅ Feedback system tables and indexes created successfully');
  },

  down: async (queryInterface, Sequelize) => {
    // Remove columns from Users table
    await queryInterface.removeColumn('Users', 'feedback_dismissed_at');
    await queryInterface.removeColumn('Users', 'feedback_submitted');

    // Drop indexes
    await queryInterface.removeIndex('feedback', 'idx_feedback_created_at');
    await queryInterface.removeIndex('feedback', 'idx_feedback_category');
    await queryInterface.removeIndex('feedback', 'idx_feedback_user_type');
    await queryInterface.removeIndex('feedback', 'idx_feedback_rating');
    await queryInterface.removeIndex('feedback', 'idx_feedback_status');
    await queryInterface.removeIndex('feedback', 'idx_feedback_user_id');

    // Drop feedback table
    await queryInterface.dropTable('feedback');

    console.log('✅ Feedback system rolled back successfully');
  }
};
