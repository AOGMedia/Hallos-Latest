'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Remove zego_room_token column as tokens should be generated per-request
    await queryInterface.removeColumn('live_classes', 'zego_room_token');
    console.log('✅ Removed zego_room_token column - tokens now generated per-request');
  },

  down: async (queryInterface, Sequelize) => {
    // Add back the column if rollback is needed
    await queryInterface.addColumn('live_classes', 'zego_room_token', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    console.log('⚠️ Re-added zego_room_token column (rollback)');
  }
};