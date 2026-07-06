'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_chuta_coin_transactions_type AS ENUM (
          'initial_bonus', 'purchase', 'withdrawal',
          'match_wager', 'match_win', 'match_refund',
          'tournament_entry', 'tournament_prize', 'tournament_refund',
          'admin_adjustment'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_chuta_coin_transactions_status AS ENUM ('pending', 'completed', 'failed', 'reversed');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "chuta_coin_transactions" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "user_id" INTEGER NOT NULL REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
        "type" enum_chuta_coin_transactions_type NOT NULL,
        "amount" DECIMAL(10,2) NOT NULL,
        "balance_after" DECIMAL(10,2) NOT NULL,
        "metadata" JSONB,
        "status" enum_chuta_coin_transactions_status NOT NULL DEFAULT 'completed',
        "description" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.addIndex('chuta_coin_transactions', ['user_id', 'created_at'], { name: 'idx_chuta_transactions_user_time' });
    await queryInterface.addIndex('chuta_coin_transactions', ['type', 'created_at'], { name: 'idx_chuta_transactions_type_time' });
    await queryInterface.addIndex('chuta_coin_transactions', ['status'], { name: 'idx_chuta_transactions_status' });
    await queryInterface.addIndex('chuta_coin_transactions', ['user_id', 'type'], { name: 'idx_chuta_transactions_user_type' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('chuta_coin_transactions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_chuta_coin_transactions_type;');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_chuta_coin_transactions_status;');
  }
};
