'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add streaming_provider column
    await queryInterface.addColumn('live_classes', 'streaming_provider', {
      type: Sequelize.ENUM('mux', 'zegocloud'),
      defaultValue: 'zegocloud',
      allowNull: false
    });
    
    // Add zego_room_token column
    await queryInterface.addColumn('live_classes', 'zego_room_token', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    
    // Add max_participants column
    await queryInterface.addColumn('live_classes', 'max_participants', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('live_classes', 'max_participants');
    await queryInterface.removeColumn('live_classes', 'zego_room_token');
    await queryInterface.removeColumn('live_classes', 'streaming_provider');
  }
};