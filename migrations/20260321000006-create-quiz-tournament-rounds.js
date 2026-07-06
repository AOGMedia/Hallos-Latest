'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_quiz_tournament_rounds_status AS ENUM ('pending', 'active', 'completed');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "quiz_tournament_rounds" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "tournament_id" UUID NOT NULL REFERENCES "quiz_tournaments"("id") ON UPDATE CASCADE ON DELETE CASCADE,
        "round_number" INTEGER NOT NULL,
        "questions" JSONB NOT NULL,
        "participants" JSONB NOT NULL DEFAULT '[]',
        "eliminated_users" JSONB NOT NULL DEFAULT '[]',
        "status" enum_quiz_tournament_rounds_status NOT NULL DEFAULT 'pending',
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.addIndex('quiz_tournament_rounds', ['tournament_id', 'round_number'], { name: 'idx_quiz_tournament_rounds_unique', unique: true });
    await queryInterface.addIndex('quiz_tournament_rounds', ['tournament_id'], { name: 'idx_quiz_tournament_rounds_tournament' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quiz_tournament_rounds');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_quiz_tournament_rounds_status;');
  }
};
