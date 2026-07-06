'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('live_sessions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      series_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'live_series',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      session_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Sequential number within the series (1, 2, 3, etc.)'
      },
      scheduled_start_time: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'When the session is scheduled to start'
      },
      scheduled_end_time: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'When the session is scheduled to end'
      },
      actual_start_time: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'When the creator actually started the session'
      },
      actual_end_time: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'When the session actually ended'
      },
      status: {
        type: Sequelize.ENUM('scheduled', 'live', 'ended', 'cancelled'),
        allowNull: false,
        defaultValue: 'scheduled'
      },
      zego_room_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'ZegoCloud room ID, created when session goes live'
      },
      zego_app_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'ZegoCloud app ID'
      },
      recording_url: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'URL to session recording (future feature)'
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
    await queryInterface.addIndex('live_sessions', ['series_id']);
    await queryInterface.addIndex('live_sessions', ['status']);
    await queryInterface.addIndex('live_sessions', ['scheduled_start_time']);
    await queryInterface.addIndex('live_sessions', ['session_number']);
    await queryInterface.addIndex('live_sessions', ['series_id', 'session_number'], {
      unique: true,
      name: 'unique_series_session_number'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('live_sessions');
  }
};
