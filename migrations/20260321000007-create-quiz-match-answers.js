'use strict';

/**
 * Migration: Create Quiz Match Answers
 * 
 * Creates the quiz_match_answers table for recording individual answer submissions
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('quiz_match_answers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      match_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'quiz_matches',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      question_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'quiz_questions',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      selected_answer: {
        type: Sequelize.STRING(1),
        allowNull: false
      },
      is_correct: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      response_time: {
        type: Sequelize.DECIMAL(10, 3),
        allowNull: false,
        comment: 'Response time in seconds'
      },
      client_timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Timestamp from client when answer was submitted'
      },
      server_timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Timestamp when server received the answer'
      },
      latency: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Calculated latency in milliseconds'
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

    // Indexes
    await queryInterface.addIndex('quiz_match_answers', ['match_id', 'user_id'], {
      name: 'idx_quiz_match_answers_match_user'
    });
    
    await queryInterface.addIndex('quiz_match_answers', ['user_id', 'created_at'], {
      name: 'idx_quiz_match_answers_user_time'
    });
    
    await queryInterface.addIndex('quiz_match_answers', ['match_id'], {
      name: 'idx_quiz_match_answers_match'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('quiz_match_answers');
  }
};
