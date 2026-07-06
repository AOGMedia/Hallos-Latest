'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add 'live_series' to the content_type enum
    // This is done by altering the column type
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_purchases_content_type" 
      ADD VALUE IF NOT EXISTS 'live_series';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Note: PostgreSQL doesn't support removing enum values easily
    // This rollback would require recreating the enum type
    // For safety, we'll leave the enum value in place
    console.log('Warning: Cannot remove enum value in PostgreSQL. Manual intervention required if rollback is needed.');
  }
};
