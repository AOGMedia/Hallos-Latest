'use strict';

/**
 * Migration: Create Quiz Categories Table
 * 
 * Creates the quiz_categories table for storing question categories
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Enable UUID extension if not already enabled
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    );

    // Create quiz_categories table
    await queryInterface.createTable('quiz_categories', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      question_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    // Add indexes
    await queryInterface.addIndex('quiz_categories', ['name'], {
      name: 'idx_quiz_categories_name',
      unique: true
    });

    await queryInterface.addIndex('quiz_categories', ['is_active'], {
      name: 'idx_quiz_categories_is_active'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('quiz_categories');
  }
};
