const lobbyService = require('../services/lobbyService');

/**
 * Quiz Lobby Controller
 * 
 * Handles 1v1 challenge operations:
 * - Create challenges
 * - Accept/decline/counter challenges
 * - Match management
 * - Forfeit
 */

/**
 * Create a new challenge
 * POST /api/quiz/lobby/challenge/create
 */
exports.createChallenge = async (req, res) => {
  try {
    const userId = req.user.id;
    const { wagerAmount, categoryId, opponentId } = req.body;

    if (wagerAmount === undefined || !categoryId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: wagerAmount, categoryId'
      });
    }

    const result = await lobbyService.createChallenge(userId, wagerAmount, categoryId, opponentId);

    return res.status(201).json(result);
  } catch (error) {
    console.error('[Quiz Lobby Controller] Create challenge error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create challenge'
    });
  }
};

/**
 * Get available challenges
 * GET /api/quiz/lobby/challenges
 */
exports.getChallenges = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status = 'pending', page = 1, limit = 20 } = req.query;

    const result = await lobbyService.getChallenges({
      status,
      page: parseInt(page),
      limit: parseInt(limit),
      excludeUserId: userId
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Quiz Lobby Controller] Get challenges error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get challenges'
    });
  }
};

/**
 * Accept a challenge
 * POST /api/quiz/lobby/challenge/:id/accept
 */
exports.acceptChallenge = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: challengeId } = req.params;

    const result = await lobbyService.acceptChallenge(challengeId, userId);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Lobby Controller] Accept challenge error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to accept challenge'
    });
  }
};

/**
 * Decline a challenge
 * POST /api/quiz/lobby/challenge/:id/decline
 */
exports.declineChallenge = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: challengeId } = req.params;

    const result = await lobbyService.declineChallenge(challengeId, userId);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Lobby Controller] Decline challenge error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to decline challenge'
    });
  }
};

/**
 * Counter-offer a challenge
 * POST /api/quiz/lobby/challenge/:id/counter
 */
exports.counterOffer = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: challengeId } = req.params;
    const { newWagerAmount } = req.body;

    if (newWagerAmount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: newWagerAmount'
      });
    }

    const result = await lobbyService.counterOffer(challengeId, userId, newWagerAmount);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Lobby Controller] Counter offer error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to counter offer'
    });
  }
};

/**
 * Get match details
 * GET /api/quiz/lobby/match/:id
 */
exports.getMatch = async (req, res) => {
  try {
    const { id: matchId } = req.params;

    const match = await lobbyService.getMatch(matchId);

    return res.status(200).json({
      success: true,
      match
    });
  } catch (error) {
    console.error('[Quiz Lobby Controller] Get match error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get match'
    });
  }
};

/**
 * Forfeit a match
 * POST /api/quiz/lobby/match/:id/forfeit
 */
exports.forfeitMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: matchId } = req.params;

    const result = await lobbyService.forfeitMatch(matchId, userId);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Lobby Controller] Forfeit match error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to forfeit match'
    });
  }
};

/**
 * Cancel a challenge
 * POST /api/quiz/lobby/challenge/:id/cancel
 */
exports.cancelChallenge = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: challengeId } = req.params;

    const result = await lobbyService.cancelChallenge(challengeId, userId);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Lobby Controller] Cancel challenge error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel challenge'
    });
  }
};

/**
 * Get active match for current user (sync/recovery)
 * GET /api/quiz/lobby/active-match
 */
exports.getActiveMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await lobbyService.getActiveMatchForUser(userId);

    return res.status(200).json({
      success: true,
      match: result
    });
  } catch (error) {
    console.error('[Quiz Lobby Controller] Get active match error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get active match'
    });
  }
};

/**
 * Submit answer via REST (fallback when socket is down)
 * POST /api/quiz/lobby/match/:id/answer
 */
exports.submitAnswer = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: matchId } = req.params;
    const { questionId, answerId, clientTimestamp } = req.body;

    if (!questionId || !answerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: questionId, answerId'
      });
    }

    const result = await lobbyService.submitAnswer(
      matchId,
      userId,
      questionId,
      answerId,
      clientTimestamp || Date.now()
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Lobby Controller] Submit answer (REST) error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to submit answer'
    });
  }
};

module.exports = exports;
