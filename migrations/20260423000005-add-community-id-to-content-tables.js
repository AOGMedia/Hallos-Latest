'use strict';

const TABLES = ['live_classes', 'live_series', 'videos', 'freebies'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    for (const table of TABLES) {
      await queryInterface.addColumn(table, 'community_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'communities', key: 'id' },
        onDelete: 'SET NULL'
      });
      await queryInterface.addColumn(table, 'community_visibility', {
        type: Sequelize.STRING(20),
        allowNull: true
      });
      await queryInterface.addIndex(table, ['community_id'], {
        name: `idx_${table}_community_id`
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    for (const table of TABLES) {
      await queryInterface.removeIndex(table, `idx_${table}_community_id`);
      await queryInterface.removeColumn(table, 'community_visibility');
      await queryInterface.removeColumn(table, 'community_id');
    }
  }
};
