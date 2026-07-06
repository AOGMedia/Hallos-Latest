'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_quiz_matches_status" ADD VALUE IF NOT EXISTS 'expired'`
    );
  },

  async down() {
    // Postgres does not support removing enum values without recreating the type
    // No-op for rollback
  }
};
