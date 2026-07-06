'use strict';

/**
 * Migration: Create Quiz Questions Table
 * 
 * Creates the quiz_questions table for storing quiz questions
 * Includes pg_trgm extension for duplicate detection
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Enable pg_trgm extension for text similarity (duplicate detection)
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
    );

    // Create difficulty enum type
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_quiz_questions_difficulty AS ENUM ('easy', 'medium', 'hard');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create quiz_questions table
    await queryInterface.createTable('quiz_questions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      category_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'quiz_categories',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      question_text: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      options: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: '{ a: "...", b: "...", c: "...", d: "..." }'
      },
      correct_answer: {
        type: Sequelize.STRING(1),
        allowNull: false
      },
      difficulty: {
        type: Sequelize.ENUM('easy', 'medium', 'hard'),
        allowNull: false,
        defaultValue: 'medium'
      },
      usage_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
    await queryInterface.addIndex('quiz_questions', ['category_id', 'difficulty'], {
      name: 'idx_quiz_questions_category_difficulty'
    });

    await queryInterface.addIndex('quiz_questions', ['created_by'], {
      name: 'idx_quiz_questions_created_by'
    });

    await queryInterface.addIndex('quiz_questions', ['is_active'], {
      name: 'idx_quiz_questions_is_active'
    });

    // Add GIN index for text similarity (duplicate detection)
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_quiz_questions_question_text_trgm 
      ON quiz_questions 
      USING gin (question_text gin_trgm_ops);
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('quiz_questions');
    
    // Drop enum type
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS enum_quiz_questions_difficulty;
    `);
  }
};
