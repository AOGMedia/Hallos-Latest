'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add ZegoCloud fields to existing live_classes table
    await queryInterface.addColumn('live_classes', 'zego_room_id', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'ZegoCloud room identifier for browser-based streaming'
    });
    
    await queryInterface.addColumn('live_classes', 'zego_app_id', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'ZegoCloud application ID for room configuration'
    });
    
    await queryInterface.addColumn('live_classes', 'streaming_provider', {
      type: Sequelize.ENUM('mux', 'zegocloud'),
      defaultValue: 'zegocloud',
      allowNull: false,
      comment: 'Streaming provider: mux (OBS-based) or zegocloud (browser-based)'
    });
    
    await queryInterface.addColumn('live_classes', 'zego_room_token', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'ZegoCloud room access token for authentication'
    });
    
    await queryInterface.addColumn('live_classes', 'max_participants', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Maximum number of participants (null = unlimited)'
    });

    // Add index for efficient querying by streaming provider
    await queryInterface.addIndex('live_classes', ['streaming_provider'], {
      name: 'idx_live_classes_streaming_provider'
    });

    // Add index for ZegoCloud room lookups (unique where not null)
    await queryInterface.addIndex('live_classes', ['zego_room_id'], {
      name: 'idx_live_classes_zego_room_id',
      unique: true
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove indexes first
    await queryInterface.removeIndex('live_classes', 'idx_live_classes_zego_room_id');
    await queryInterface.removeIndex('live_classes', 'idx_live_classes_streaming_provider');
    
    // Remove ZegoCloud columns
    await queryInterface.removeColumn('live_classes', 'max_participants');
    await queryInterface.removeColumn('live_classes', 'zego_room_token');
    await queryInterface.removeColumn('live_classes', 'streaming_provider');
    await queryInterface.removeColumn('live_classes', 'zego_app_id');
    await queryInterface.removeColumn('live_classes', 'zego_room_id');
  }
};