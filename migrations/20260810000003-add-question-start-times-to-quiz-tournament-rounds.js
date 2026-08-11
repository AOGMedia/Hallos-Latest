'use strict';

/**
 * Migration: Add question_start_times to quiz_tournament_rounds
 *
 * Mirrors quiz_matches.question_start_times — server-side authoritative timing
 * per question, so response time for shared-question-set formats (classic,
 * speed_run, battle_royale) can't be gamed by a client-reported timestamp alone.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('quiz_tournament_rounds', 'question_start_times', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {}
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('quiz_tournament_rounds', 'question_start_times');
  }
};
