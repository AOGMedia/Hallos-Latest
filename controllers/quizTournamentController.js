const tournamentService = require('../services/tournamentService');

/**
 * Quiz Tournament Controller
 * 
 * Handles tournament operations:
 * - List tournaments
 * - Get tournament details
 * - Register/unregister
 * - View leaderboard
 */

/**
 * Get tournaments list
 * GET /api/quiz/tournaments
 */
exports.getTournaments = async (req, res) => {
  try {
    const { status, format, page = 1, limit = 20 } = req.query;

    const result = await tournamentService.getTournaments({
      status,
      format,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Quiz Tournament Controller] Get tournaments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get tournaments'
    });
  }
};

/**
 * Get tournament details
 * GET /api/quiz/tournament/:id
 */
exports.getTournament = async (req, res) => {
  try {
    const { id: tournamentId } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin'; // Assuming user has role field

    const tournament = await tournamentService.getTournament(tournamentId);

    // Implement participant list privacy
    // Hide participant list before tournament starts unless user is admin
    const now = new Date();
    const tournamentStarted = tournament.status === 'in_progress' || 
                               tournament.status === 'completed' ||
                               new Date(tournament.startTime) <= now;

    let participants = tournament.participants || [];
    
    // If tournament hasn't started and user is not admin, hide participant list
    if (!tournamentStarted && !isAdmin) {
      participants = []; // Hide participant list
    }

    return res.status(200).json({
      success: true,
      tournament: {
        ...tournament.toJSON(),
        participants // May be empty array if hidden
      },
      participantCount: tournament.participants ? tournament.participants.length : 0,
      prizePool: tournament.prizePool,
      participantsHidden: !tournamentStarted && !isAdmin
    });
  } catch (error) {
    console.error('[Quiz Tournament Controller] Get tournament error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get tournament'
    });
  }
};

/**
 * Register for tournament
 * POST /api/quiz/tournament/:id/register
 */
exports.registerForTournament = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: tournamentId } = req.params;

    const result = await tournamentService.registerParticipant(tournamentId, userId);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Tournament Controller] Register error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to register for tournament'
    });
  }
};

/**
 * Unregister from tournament
 * POST /api/quiz/tournament/:id/unregister
 */
exports.unregisterFromTournament = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: tournamentId } = req.params;

    const result = await tournamentService.unregisterParticipant(tournamentId, userId);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Tournament Controller] Unregister error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to unregister from tournament'
    });
  }
};

/**
 * Get tournament leaderboard
 * GET /api/quiz/tournament/:id/leaderboard
 */
exports.getTournamentLeaderboard = async (req, res) => {
  try {
    const { id: tournamentId } = req.params;

    const result = await tournamentService.getTournamentLeaderboard(tournamentId);

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Quiz Tournament Controller] Get leaderboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get tournament leaderboard'
    });
  }
};

module.exports = exports;
