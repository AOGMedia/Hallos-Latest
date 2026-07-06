const leaderboardService = require('../services/leaderboardService');

/**
 * Quiz Leaderboard Controller
 * 
 * Handles leaderboard operations:
 * - Global leaderboard
 * - Lobby leaderboard
 * - Tournament leaderboard
 */

/**
 * Get global leaderboard
 * GET /api/quiz/leaderboard/global
 */
exports.getGlobalLeaderboard = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { page = 1, limit = 50 } = req.query;

    const result = await leaderboardService.getGlobalLeaderboard({
      page: parseInt(page),
      limit: parseInt(limit),
      userId
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Quiz Leaderboard Controller] Get global leaderboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get global leaderboard'
    });
  }
};

/**
 * Get lobby leaderboard
 * GET /api/quiz/leaderboard/lobby
 */
exports.getLobbyLeaderboard = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const result = await leaderboardService.getLobbyLeaderboard({
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Quiz Leaderboard Controller] Get lobby leaderboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get lobby leaderboard'
    });
  }
};

/**
 * Get tournament leaderboard
 * GET /api/quiz/leaderboard/tournament
 */
exports.getTournamentLeaderboard = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const result = await leaderboardService.getTournamentLeaderboard({
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Quiz Leaderboard Controller] Get tournament leaderboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get tournament leaderboard'
    });
  }
};

module.exports = exports;
