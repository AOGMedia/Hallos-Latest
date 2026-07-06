'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_quiz_tournament_participants_status AS ENUM ('registered', 'active', 'eliminated', 'winner');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "quiz_tournament_participants" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "tournament_id" UUID NOT NULL REFERENCES "quiz_tournaments"("id") ON UPDATE CASCADE ON DELETE CASCADE,
        "user_id" INTEGER NOT NULL REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
        "entry_fee_paid" DECIMAL(10,2) NOT NULL,
        "current_round" INTEGER NOT NULL DEFAULT 0,
        "status" enum_quiz_tournament_participants_status NOT NULL DEFAULT 'registered',
        "total_score" INTEGER NOT NULL DEFAULT 0,
        "average_time" DECIMAL(10,2),
        "placement" INTEGER,
        "prize_won" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "registered_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "eliminated_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.addIndex('quiz_tournament_participants', ['tournament_id', 'user_id'], { name: 'idx_quiz_tournament_participants_unique', unique: true });
    await queryInterface.addIndex('quiz_tournament_participants', ['tournament_id', 'status'], { name: 'idx_quiz_tournament_participants_status' });
    await queryInterface.addIndex('quiz_tournament_participants', ['user_id'], { name: 'idx_quiz_tournament_participants_user' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quiz_tournament_participants');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_quiz_tournament_participants_status;');
  }
};
