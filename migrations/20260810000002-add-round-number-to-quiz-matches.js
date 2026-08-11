'use strict';

/**
 * Migration: Add round_number to quiz_matches
 *
 * Tournament knockout rounds reuse the 1v1 QuizMatch engine (real matches,
 * real scoring, real answer submission) rather than reinventing head-to-head
 * play. This column lets a round's matches be queried directly
 * (`WHERE tournament_id = ? AND round_number = ?`) instead of needing a
 * separate join table.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('quiz_matches', 'round_number', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Tournament round this match belongs to (tournament matches only)'
    });

    await queryInterface.addIndex('quiz_matches', ['tournament_id', 'round_number'], {
      name: 'idx_quiz_matches_tournament_round'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('quiz_matches', 'idx_quiz_matches_tournament_round');
    await queryInterface.removeColumn('quiz_matches', 'round_number');
  }
};
