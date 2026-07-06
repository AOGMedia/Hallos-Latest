'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('🔄 Adding is_free_preview column to freebie_items...');

    await queryInterface.addColumn('freebie_items', 'is_free_preview', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Whether this item is freely downloadable as a preview, even on paid freebies'
    });

    console.log('✅ Added is_free_preview column');
    console.log('✅ Migration completed successfully!');
  },

  down: async (queryInterface, Sequelize) => {
    console.log('🔄 Reverting is_free_preview column from freebie_items...');

    await queryInterface.removeColumn('freebie_items', 'is_free_preview');
    console.log('✅ Removed is_free_preview column');

    console.log('✅ Rollback completed successfully!');
  }
};
