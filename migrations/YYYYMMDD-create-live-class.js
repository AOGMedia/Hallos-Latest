'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Enable uuid extension (Postgres)
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    await queryInterface.createTable('live_classes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      title: { type: Sequelize.STRING },
      description: { type: Sequelize.TEXT },
      price: { type: Sequelize.DECIMAL(10,2), defaultValue: 0 },
      thumbnail_url: { type: Sequelize.STRING },
      start_time: { type: Sequelize.DATE },
      end_time: { type: Sequelize.DATE },
      privacy: { type: Sequelize.ENUM('public','private'), defaultValue: 'public' },
      status: { type: Sequelize.ENUM('scheduled','live','ended','recorded'), defaultValue: 'scheduled' },
      mux_stream_id: { type: Sequelize.STRING },
      mux_stream_key: { type: Sequelize.STRING },
      mux_rtmp_url: { type: Sequelize.STRING },
      mux_playback_id: { type: Sequelize.STRING },
      recording_asset_id: { type: Sequelize.STRING },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('live_classes');
  }
};