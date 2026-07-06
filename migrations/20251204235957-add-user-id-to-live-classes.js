'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('live_classes', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: true, // Allow null initially for existing records
      references: {
        model: 'Users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });

    // Add index
    await queryInterface.addIndex('live_classes', ['user_id'], {
      name: 'idx_live_classes_user'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('live_classes', 'idx_live_classes_user');
    await queryInterface.removeColumn('live_classes', 'user_id');
  }
};
