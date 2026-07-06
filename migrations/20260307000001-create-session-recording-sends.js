'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('session_recording_sends', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
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
      drive_link: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      send_batch_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Index for checking if user already received recording for a session
    await queryInterface.addIndex('session_recording_sends', 
      ['series_id', 'session_number', 'user_id'], 
      {
        name: 'idx_recording_sends_unique_check',
        unique: false
      }
    );

    // Index for batch tracking
    await queryInterface.addIndex('session_recording_sends', 
      ['send_batch_id'], 
      {
        name: 'idx_recording_sends_batch'
      }
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('session_recording_sends');
  }
};
