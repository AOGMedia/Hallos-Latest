'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_quiz_matches_match_type AS ENUM ('lobby', 'tournament');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_quiz_matches_status AS ENUM ('pending', 'active', 'completed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "quiz_matches" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "match_type" enum_quiz_matches_match_type NOT NULL,
        "tournament_id" UUID REFERENCES "quiz_tournaments"("id") ON UPDATE CASCADE ON DELETE SET NULL,
        "participants" JSONB NOT NULL DEFAULT '[]',
        "questions" UUID[] NOT NULL DEFAULT '{}',
        "question_start_times" JSONB,
        "status" enum_quiz_matches_status NOT NULL DEFAULT 'pending',
        "winner_id" INTEGER REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
        "escrow_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.addIndex('quiz_matches', ['status', 'created_at'], {
      name: 'idx_quiz_matches_status_created'
    });
    await queryInterface.addIndex('quiz_matches', ['tournament_id'], {
      name: 'idx_quiz_matches_tournament_id'
    });
    await queryInterface.addIndex('quiz_matches', ['winner_id'], {
      name: 'idx_quiz_matches_winner_id'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quiz_matches');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_quiz_matches_match_type;');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_quiz_matches_status;');
  }
};
