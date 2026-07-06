'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Free spot reservations for live series
    await queryInterface.createTable('live_series_registrations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      series_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'live_series', key: 'id' },
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

    await queryInterface.addIndex('live_series_registrations', ['series_id'], {
      name: 'idx_live_series_registrations_series_id'
    });
    await queryInterface.addIndex('live_series_registrations', ['user_id'], {
      name: 'idx_live_series_registrations_user_id'
    });
    // Prevent duplicate registrations
    await queryInterface.addIndex('live_series_registrations', ['series_id', 'user_id'], {
      unique: true,
      name: 'idx_live_series_registrations_unique'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('live_series_registrations');
  }
};
