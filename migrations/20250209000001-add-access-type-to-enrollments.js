'use strict';

/**
 * Migration: Add access type and expiry to course enrollments
 * 
 * Changes:
 * 1. Add access_type ENUM (individual, monthly, yearly)
 * 2. Add expires_at DATE field
 * 3. Make course_id nullable (for monthly/yearly access to all courses)
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('🔄 Adding access_type and expires_at to course_enrollments...');

    // 1. Add access_type ENUM
    await queryInterface.addColumn('course_enrollments', 'access_type', {
      type: Sequelize.ENUM('individual', 'monthly', 'yearly'),
      allowNull: false,
      defaultValue: 'individual',
      comment: 'Type of access purchased: individual course, monthly all-access, or yearly all-access'
    });

    console.log('✅ Added access_type column');

    // 2. Add expires_at DATE
    await queryInterface.addColumn('course_enrollments', 'expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Expiry date for monthly/yearly access. NULL for individual courses (lifetime access)'
    });

    console.log('✅ Added expires_at column');

    // 3. Make course_id nullable (for monthly/yearly access)
    await queryInterface.changeColumn('course_enrollments', 'course_id', {
      type: Sequelize.UUID,
      allowNull: true,
      comment: 'Course ID for individual purchases. NULL for monthly/yearly all-access'
    });

    console.log('✅ Made course_id nullable');
    console.log('✅ Migration completed successfully!');
  },

  down: async (queryInterface, Sequelize) => {
    console.log('🔄 Reverting access_type and expires_at changes...');

    // Remove added columns
    await queryInterface.removeColumn('course_enrollments', 'expires_at');
    console.log('✅ Removed expires_at column');

    await queryInterface.removeColumn('course_enrollments', 'access_type');
    console.log('✅ Removed access_type column');

    // Revert course_id to NOT NULL
    await queryInterface.changeColumn('course_enrollments', 'course_id', {
      type: Sequelize.UUID,
      allowNull: false
    });

    console.log('✅ Reverted course_id to NOT NULL');
    console.log('✅ Rollback completed successfully!');
  }
};
