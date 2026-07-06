const UserQuizStats = require('../models/UserQuizStats');
const User = require('../models/User');
const { Op } = require('sequelize');
const { createRedisClient } = require('../config/redis');

/**
 * Leaderboard Service
 * 
 * Manages leaderboard operations with Redis caching:
 * - Global leaderboard by total winnings
 * - Tournament-specific leaderboards
 * - User ranking
 * - 5-minute cache TTL
 */

class LeaderboardService {
  constructor() {
    this.redis = null;
    this.CACHE_TTL = 300; // 5 minutes
    this.CACHE_PREFIX = 'quiz:leaderboard:';
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    try {
      // Initialize Redis connection using centralized config
      this.redis = createRedisClient();

      console.log('✅ Leaderboard Service initialized with Redis caching');
    } catch (error) {
      console.error('❌ Leaderboard Service initialization failed:', error.message);
      // Continue without Redis caching
    }
  }

  /**
   * Get cached data or fetch from database
   * 
   * @param {string} cacheKey - Redis cache key
   * @param {Function} fetchFn - Function to fetch data if cache miss
   * @returns {Promise<any>}
   */
  async getCachedOrFetch(cacheKey, fetchFn) {
    // Try to get from cache
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        console.error('[LeaderboardService] Cache read error:', error.message);
      }
    }

    // Cache miss - fetch from database
    const data = await fetchFn();

    // Store in cache
    if (this.redis) {
      try {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(data));
      } catch (error) {
        console.error('[LeaderboardService] Cache write error:', error.message);
      }
    }

    return data;
  }

  /**
   * Invalidate leaderboard cache
   * 
   * @param {string} type - Leaderboard type ('global', 'lobby', 'tournament', or 'all')
   */
  async invalidateCache(type = 'all') {
    if (!this.redis) return;

    try {
      if (type === 'all') {
        const keys = await this.redis.keys(`${this.CACHE_PREFIX}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } else {
        const keys = await this.redis.keys(`${this.CACHE_PREFIX}${type}:*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }
      console.log(`[LeaderboardService] Cache invalidated: ${type}`);
    } catch (error) {
      console.error('[LeaderboardService] Cache invalidation error:', error.message);
    }
  }
  /**
   * Get global leaderboard by total winnings
   * 
   * @param {Object} options - Query options (page, limit)
   * @returns {Promise<{rankings: Array, userRank: number, totalPlayers: number}>}
   */
  async getGlobalLeaderboard(options = {}) {
    const { page = 1, limit = 50, userId = null } = options;
    const cacheKey = `${this.CACHE_PREFIX}global:page${page}:limit${limit}`;

    return this.getCachedOrFetch(cacheKey, async () => {
      const offset = (page - 1) * limit;

      // Get top players by total winnings (lobby + tournament)
      const stats = await UserQuizStats.findAll({
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstname', 'lastname', 'email']
          }
        ],
        order: [
          [
            require('sequelize').literal(
              "((lobby_stats->>'totalWinnings')::numeric + (tournament_stats->>'totalPrizeMoney')::numeric)"
            ),
            'DESC'
          ]
        ],
        limit,
        offset
      });

      // Calculate total players
      const totalPlayers = await UserQuizStats.count();

      // Format rankings
      const rankings = stats.map((stat, index) => {
        const lobbyWinnings = parseFloat(stat.lobbyStats?.totalWinnings || 0);
        const tournamentPrizes = parseFloat(stat.tournamentStats?.totalPrizeMoney || 0);
        const totalWinnings = lobbyWinnings + tournamentPrizes;

        return {
          rank: offset + index + 1,
          userId: stat.userId,
          nickname: stat.nickname || `Player_${stat.userId}`,
          avatarUrl: stat.avatarUrl || null,
          totalWinnings,
          lobbyWinnings,
          tournamentPrizes,
          lobbyStats: {
            matches: stat.lobbyStats?.totalMatches || 0,
            wins: stat.lobbyStats?.wins || 0,
            winRate: stat.lobbyStats?.winRate || 0
          },
          tournamentStats: {
            entered: stat.tournamentStats?.tournamentsEntered || 0,
            won: stat.tournamentStats?.tournamentsWon || 0,
            top3: stat.tournamentStats?.top3Finishes || 0
          }
        };
      });

      // Get user's rank if userId provided
      let userRank = null;
      if (userId) {
        userRank = await this.getUserRank(userId);
      }

      return {
        rankings,
        userRank,
        totalPlayers,
        page,
        totalPages: Math.ceil(totalPlayers / limit)
      };
    });
  }

  /**
   * Get user's global rank
   * 
   * @param {number} userId - User ID
   * @returns {Promise<number>} - User's rank (1-indexed)
   */
  async getUserRank(userId) {
    const userStats = await UserQuizStats.findOne({
      where: { userId }
    });

    if (!userStats) {
      return null;
    }

    const userTotalWinnings = 
      parseFloat(userStats.lobbyStats?.totalWinnings || 0) +
      parseFloat(userStats.tournamentStats?.totalPrizeMoney || 0);

    // Count how many users have higher total winnings
    const higherRanked = await UserQuizStats.count({
      where: require('sequelize').literal(
        `((lobby_stats->>'totalWinnings')::numeric + (tournament_stats->>'totalPrizeMoney')::numeric) > ${userTotalWinnings}`
      )
    });

    return higherRanked + 1;
  }

  /**
   * Get lobby-specific leaderboard
   * 
   * @param {Object} options - Query options
   * @returns {Promise<Object>}
   */
  async getLobbyLeaderboard(options = {}) {
    const { page = 1, limit = 50 } = options;
    const cacheKey = `${this.CACHE_PREFIX}lobby:page${page}:limit${limit}`;

    return this.getCachedOrFetch(cacheKey, async () => {
      const offset = (page - 1) * limit;

      const stats = await UserQuizStats.findAll({
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstname', 'lastname']
          }
        ],
        where: require('sequelize').literal(
          "(lobby_stats->>'totalMatches')::integer > 0"
        ),
        order: [
          [
            require('sequelize').literal("(lobby_stats->>'totalWinnings')::numeric"),
            'DESC'
          ]
        ],
        limit,
        offset
      });

      const rankings = stats.map((stat, index) => ({
        rank: offset + index + 1,
        userId: stat.userId,
        nickname: stat.nickname || `Player_${stat.userId}`,
        avatarUrl: stat.avatarUrl || null,
        totalWinnings: parseFloat(stat.lobbyStats?.totalWinnings || 0),
        matches: stat.lobbyStats?.totalMatches || 0,
        wins: stat.lobbyStats?.wins || 0,
        winRate: stat.lobbyStats?.winRate || 0
      }));

      return {
        rankings,
        page,
        totalPages: Math.ceil(stats.length / limit)
      };
    });
  }

  /**
   * Get tournament-specific leaderboard
   * 
   * @param {Object} options - Query options
   * @returns {Promise<Object>}
   */
  async getTournamentLeaderboard(options = {}) {
    const { page = 1, limit = 50 } = options;
    const cacheKey = `${this.CACHE_PREFIX}tournament:page${page}:limit${limit}`;

    return this.getCachedOrFetch(cacheKey, async () => {
      const offset = (page - 1) * limit;

      const stats = await UserQuizStats.findAll({
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstname', 'lastname']
          }
        ],
        where: require('sequelize').literal(
          "(tournament_stats->>'tournamentsEntered')::integer > 0"
        ),
        order: [
          [
            require('sequelize').literal("(tournament_stats->>'totalPrizeMoney')::numeric"),
            'DESC'
          ]
        ],
        limit,
        offset
      });

      const rankings = stats.map((stat, index) => ({
        rank: offset + index + 1,
        userId: stat.userId,
        nickname: stat.nickname || `Player_${stat.userId}`,
        avatarUrl: stat.avatarUrl || null,
        totalPrizeMoney: parseFloat(stat.tournamentStats?.totalPrizeMoney || 0),
        tournamentsEntered: stat.tournamentStats?.tournamentsEntered || 0,
        tournamentsWon: stat.tournamentStats?.tournamentsWon || 0,
        top3Finishes: stat.tournamentStats?.top3Finishes || 0
      }));

      return {
        rankings,
        page,
        totalPages: Math.ceil(stats.length / limit)
      };
    });
  }
}

module.exports = new LeaderboardService();
