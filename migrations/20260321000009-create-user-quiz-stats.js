'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('user_quiz_stats', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      lobby_stats: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {
          totalMatches: 0, wins: 0, losses: 0, forfeits: 0,
          winRate: 0, totalWagered: 0, totalWinnings: 0,
          totalLosses: 0, netProfit: 0, averageScore: 0, averageTime: 0
        }
      },
      tournament_stats: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {
          tournamentsEntered: 0, tournamentsWon: 0, top3Finishes: 0,
          totalPrizeMoney: 0, totalEntryFees: 0, netProfit: 0
        }
      },
      overall_stats: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {
          totalQuestions: 0, correctAnswers: 0, accuracy: 0,
          fastestAnswer: null, currentStreak: 0, longestStreak: 0
        }
      },
      last_match_at: { type: Sequelize.DATE, allowNull: true },
      last_tournament_at: { type: Sequelize.DATE, allowNull: true },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('user_quiz_stats', ['user_id'], {
      name: 'idx_user_quiz_stats_user',
      unique: true
    });

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_quiz_stats_lobby_winnings"
      ON "user_quiz_stats" (((lobby_stats->>'totalWinnings')::numeric) DESC);
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_quiz_stats_tournament_prizes"
      ON "user_quiz_stats" (((tournament_stats->>'totalPrizeMoney')::numeric) DESC);
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('user_quiz_stats');
  }
};
