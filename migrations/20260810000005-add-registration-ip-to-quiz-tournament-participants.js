'use strict';

/**
 * Migration: Add registration_ip to quiz_tournament_participants
 *
 * Captured at registration time for non-blocking fairness flagging (see
 * tournamentService._flagSuspiciousRegistration) — two participants
 * registering from the same IP gets surfaced to admins via the existing
 * suspiciousActivityService violation counter, not auto-blocked.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('quiz_tournament_participants', 'registration_ip', {
      type: Sequelize.STRING,
      allowNull: true
    });

    await queryInterface.addIndex('quiz_tournament_participants', ['tournament_id', 'registration_ip'], {
      name: 'idx_quiz_tournament_participants_tournament_ip'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('quiz_tournament_participants', 'idx_quiz_tournament_participants_tournament_ip');
    await queryInterface.removeColumn('quiz_tournament_participants', 'registration_ip');
  }
};
