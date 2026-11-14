'use strict';

/**
 * financial_transactions.reference: 50 → 255 characters, so Stripe session
 * ids (~66) fit. The server also does this on boot (utils/ensureLedgerReferences.js);
 * this migration keeps fresh databases built from migrations in step.
 * Raw SQL on purpose: changeColumn would try to re-add the unique constraint.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE financial_transactions ALTER COLUMN reference TYPE VARCHAR(255)');
  },

  async down() {
    // Not narrowed back: rows longer than 50 characters may exist by then.
  },
};
