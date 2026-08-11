'use strict';

/**
 * Migration: Create quiz_tournament_answers
 *
 * Records individual answer submissions for shared-question-set tournament
 * formats (classic, speed_run, battle_royale) — mirrors quiz_match_answers,
 * scoped to a tournament round instead of a 1v1 match. Knockout format doesn't
 * use this table; it reuses quiz_match_answers via real QuizMatch rows.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('quiz_tournament_answers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      round_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'quiz_tournament_rounds', key: 'id' },
        onDelete: 'CASCADE'
      },
      tournament_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'quiz_tournaments', key: 'id' },
        onDelete: 'CASCADE'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
      },
      question_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'quiz_questions', key: 'id' }
      },
      selected_answer: {
        type: Sequelize.STRING(7),
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
        type: Sequelize.BIGINT,
        allowNull: false
      },
      server_timestamp: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
      latency: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('quiz_tournament_answers', ['round_id', 'user_id', 'question_id'], {
      name: 'idx_quiz_tournament_answers_unique_submission',
      unique: true
    });

    await queryInterface.addIndex('quiz_tournament_answers', ['tournament_id', 'user_id'], {
      name: 'idx_quiz_tournament_answers_tournament_user'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quiz_tournament_answers');
  }
};
