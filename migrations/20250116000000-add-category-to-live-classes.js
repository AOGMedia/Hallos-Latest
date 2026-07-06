'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('live_classes', 'category', {
      type: Sequelize.STRING,
      allowNull: true,
      after: 'price' // Add after price column for logical ordering
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('live_classes', 'category');
  }
};
