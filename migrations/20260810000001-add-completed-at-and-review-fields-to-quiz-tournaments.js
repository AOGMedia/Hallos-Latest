'use strict';

/**
 * Migration: Fix quiz_tournaments schema gaps found in the tournament audit
 *
 * - `completed_at` was being written by tournamentService but never existed as a
 *   column (Sequelize silently dropped it) — tournament completion time was never
 *   actually persisted.
 * - Adds review-trail fields + two new status values needed for user-hosted
 *   tournament proposals: `pending_review` (awaiting admin approval) and
 *   `rejected` (admin declined).
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('quiz_tournaments', 'completed_at', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('quiz_tournaments', 'reviewed_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    });

    await queryInterface.addColumn('quiz_tournaments', 'reviewed_at', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('quiz_tournaments', 'rejection_reason', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    // Postgres enum types can't have values added inside certain transaction
    // contexts on older versions, but ADD VALUE IF NOT EXISTS is safe on PG12+.
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_quiz_tournaments_status" ADD VALUE IF NOT EXISTS 'pending_review';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_quiz_tournaments_status" ADD VALUE IF NOT EXISTS 'rejected';`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('quiz_tournaments', 'completed_at');
    await queryInterface.removeColumn('quiz_tournaments', 'reviewed_by');
    await queryInterface.removeColumn('quiz_tournaments', 'reviewed_at');
    await queryInterface.removeColumn('quiz_tournaments', 'rejection_reason');
    // Removing enum values isn't supported by Postgres without recreating the
    // type; intentionally left as a no-op on down (matches the read-only
    // nature of enum value additions elsewhere in this codebase).
  }
};
