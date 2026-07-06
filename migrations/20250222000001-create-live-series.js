'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('live_series', {
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
      title: {
        type: Sequelize.STRING,
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'NGN'
      },
      thumbnail_url: {
        type: Sequelize.STRING,
        allowNull: true
      },
      category: {
        type: Sequelize.STRING,
        allowNull: true
      },
      start_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      end_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      recurrence_pattern: {
        type: Sequelize.JSON,
        allowNull: false,
        comment: 'JSON object with days, startTime, duration, timezone'
      },
      status: {
        type: Sequelize.ENUM('active', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'active'
      },
      privacy: {
        type: Sequelize.ENUM('public', 'private'),
        allowNull: false,
        defaultValue: 'public'
      },
      max_participants: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 50
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

    // Add indexes for better query performance
    await queryInterface.addIndex('live_series', ['user_id']);
    await queryInterface.addIndex('live_series', ['status']);
    await queryInterface.addIndex('live_series', ['start_date', 'end_date']);
    await queryInterface.addIndex('live_series', ['category']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('live_series');
  }
};
