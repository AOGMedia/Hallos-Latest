'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add coupon_id column to purchases table
    await queryInterface.addColumn('purchases', 'coupon_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'coupons',
        key: 'id'
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('purchases', 'coupon_id');
  }
};
