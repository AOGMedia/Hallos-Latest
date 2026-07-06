'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('🔄 Adding price and currency columns to freebies...');

    await queryInterface.addColumn('freebies', 'price', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
      comment: 'Price of the freebie bundle. 0.00 means free.'
    });

    console.log('✅ Added price column');

    await queryInterface.addColumn('freebies', 'currency', {
      type: Sequelize.ENUM('NGN', 'USD'),
      allowNull: false,
      defaultValue: 'NGN',
      comment: 'Currency for the freebie price'
    });

    console.log('✅ Added currency column');
    console.log('✅ Migration completed successfully!');
  },

  down: async (queryInterface, Sequelize) => {
    console.log('🔄 Reverting price and currency columns from freebies...');

    await queryInterface.removeColumn('freebies', 'currency');
    console.log('✅ Removed currency column');

    await queryInterface.removeColumn('freebies', 'price');
    console.log('✅ Removed price column');

    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_freebies_currency";');
    console.log('✅ Dropped enum_freebies_currency type');

    console.log('✅ Rollback completed successfully!');
  }
};
