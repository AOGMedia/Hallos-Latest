'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('quiz_matches');

    if (!tableInfo.challenger_id) {
      await queryInterface.addColumn('quiz_matches', 'challenger_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }

    if (!tableInfo.opponent_id) {
      await queryInterface.addColumn('quiz_matches', 'opponent_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }

    if (!tableInfo.counter_offer_id) {
      await queryInterface.addColumn('quiz_matches', 'counter_offer_id', {
        type: Sequelize.UUID,
        allowNull: true
      });
    }

    if (!tableInfo.expires_at) {
      await queryInterface.addColumn('quiz_matches', 'expires_at', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('quiz_matches', 'challenger_id');
    await queryInterface.removeColumn('quiz_matches', 'opponent_id');
    await queryInterface.removeColumn('quiz_matches', 'counter_offer_id');
    await queryInterface.removeColumn('quiz_matches', 'expires_at');
  }
};
