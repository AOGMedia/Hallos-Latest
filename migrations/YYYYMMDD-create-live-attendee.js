'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('live_attendees', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      live_class_id: { type: Sequelize.UUID, allowNull: false },
      user_id: { type: Sequelize.INTEGER, allowNull: false },
      invited_by: { type: Sequelize.INTEGER, allowNull: true },
      status_paid: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('live_attendees');
  }
};