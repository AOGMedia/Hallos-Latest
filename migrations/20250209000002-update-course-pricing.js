'use strict';

/**
 * Migration: Update Course pricing model
 * 
 * Changes:
 * 1. Make price_usd nullable (pricing moves to service layer)
 * 2. Make price_ngn nullable (pricing moves to service layer)
 * 3. Set existing prices to NULL (clean slate)
 * 
 * Rationale: Pricing is now handled by CoursePricingService with .env configuration
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('🔄 Updating Course pricing model...');

    // 1. Make price_usd nullable and remove default
    await queryInterface.changeColumn('courses', 'price_usd', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
      comment: 'Deprecated: Pricing now handled by CoursePricingService'
    });

    console.log('✅ Made price_usd nullable');

    // 2. Make price_ngn nullable and remove default
    await queryInterface.changeColumn('courses', 'price_ngn', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
      comment: 'Deprecated: Pricing now handled by CoursePricingService'
    });

    console.log('✅ Made price_ngn nullable');

    // 3. Set all existing prices to NULL (clean slate)
    await queryInterface.sequelize.query(
      'UPDATE courses SET price_usd = NULL, price_ngn = NULL'
    );

    console.log('✅ Cleared existing price data');
    console.log('✅ Migration completed successfully!');
    console.log('ℹ️  Pricing is now managed by CoursePricingService via .env');
  },

  down: async (queryInterface, Sequelize) => {
    console.log('🔄 Reverting Course pricing changes...');

    // Restore price_usd with default
    await queryInterface.changeColumn('courses', 'price_usd', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 35.00
    });

    console.log('✅ Restored price_usd with default');

    // Restore price_ngn with default
    await queryInterface.changeColumn('courses', 'price_ngn', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 50000.00
    });

    console.log('✅ Restored price_ngn with default');

    // Restore default prices for all courses
    await queryInterface.sequelize.query(
      'UPDATE courses SET price_usd = 35.00, price_ngn = 50000.00 WHERE price_usd IS NULL OR price_ngn IS NULL'
    );

    console.log('✅ Restored default prices');
    console.log('✅ Rollback completed successfully!');
  }
};
