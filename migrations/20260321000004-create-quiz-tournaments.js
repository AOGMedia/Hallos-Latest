'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_quiz_tournaments_format AS ENUM ('speed_run', 'classic', 'knockout', 'battle_royale');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_quiz_tournaments_status AS ENUM ('draft', 'open', 'in_progress', 'completed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "quiz_tournaments" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "name" VARCHAR(200) NOT NULL,
        "description" TEXT,
        "format" enum_quiz_tournaments_format NOT NULL,
        "entry_fee" DECIMAL(10,2) NOT NULL,
        "prize_distribution" JSONB NOT NULL DEFAULT '{"first":60,"second":30,"third":10}',
        "category_id" UUID NOT NULL REFERENCES "quiz_categories"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
        "max_participants" INTEGER,
        "min_participants" INTEGER NOT NULL DEFAULT 2,
        "registration_deadline" TIMESTAMP WITH TIME ZONE NOT NULL,
        "start_time" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" enum_quiz_tournaments_status NOT NULL DEFAULT 'draft',
        "current_round" INTEGER NOT NULL DEFAULT 0,
        "total_rounds" INTEGER,
        "prize_pool" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "created_by" INTEGER NOT NULL REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
        "proposed_by" INTEGER REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.addIndex('quiz_tournaments', ['status', 'start_time'], { name: 'idx_quiz_tournaments_status_start' });
    await queryInterface.addIndex('quiz_tournaments', ['registration_deadline'], { name: 'idx_quiz_tournaments_reg_deadline' });
    await queryInterface.addIndex('quiz_tournaments', ['category_id'], { name: 'idx_quiz_tournaments_category' });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quiz_tournaments');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_quiz_tournaments_format;');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_quiz_tournaments_status;');
  }
};
