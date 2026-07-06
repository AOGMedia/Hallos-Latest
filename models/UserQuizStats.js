const { DataTypes, literal } = require('sequelize');
const sequelize = require('../config/db');

/**
 * UserQuizStats Model
 * 
 * Aggregates user performance statistics across lobby and tournament modes
 * Used for leaderboards and user profiles
 */

const UserQuizStats = sequelize.define('UserQuizStats', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    field: 'user_id',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  lobbyStats: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {
      totalMatches: 0,
      wins: 0,
      losses: 0,
      forfeits: 0,
      winRate: 0,
      totalWagered: 0,
      totalWinnings: 0,
      totalLosses: 0,
      netProfit: 0,
      averageScore: 0,
      averageTime: 0
    },
    field: 'lobby_stats',
    comment: 'Lobby mode statistics'
  },
  tournamentStats: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {
      tournamentsEntered: 0,
      tournamentsWon: 0,
      top3Finishes: 0,
      totalPrizeMoney: 0,
      totalEntryFees: 0,
      netProfit: 0
    },
    field: 'tournament_stats',
    comment: 'Tournament mode statistics'
  },
  overallStats: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {
      totalQuestions: 0,
      correctAnswers: 0,
      accuracy: 0,
      fastestAnswer: null,
      currentStreak: 0,
      longestStreak: 0
    },
    field: 'overall_stats',
    comment: 'Overall quiz statistics'
  },
  lastMatchAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_match_at'
  },
  lastTournamentAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_tournament_at'
  },
  nickname: {
    type: DataTypes.STRING(30),
    allowNull: true,
    unique: true,
    validate: {
      len: [3, 30],
      is: /^[a-zA-Z0-9_]+$/  // alphanumeric + underscore only
    }
  },
  avatarUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'avatar_url'
  },
  nicknameChangedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'nickname_changed_at'
  }
}, {
  tableName: 'user_quiz_stats',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id']
    },
    {
      fields: [literal("((lobby_stats->>'totalWinnings')::numeric)")],
      name: 'idx_user_quiz_stats_lobby_winnings'
    },
    {
      fields: [literal("((tournament_stats->>'totalPrizeMoney')::numeric)")],
      name: 'idx_user_quiz_stats_tournament_prizes'
    }
  ]
});

/**
 * Associations
 */
UserQuizStats.associate = (models) => {
  UserQuizStats.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user'
  });
};

module.exports = UserQuizStats;
