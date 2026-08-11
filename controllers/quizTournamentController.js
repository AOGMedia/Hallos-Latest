const tournamentService = require('../services/tournamentService');

/**
 * Quiz Tournament Controller
 *
 * Handles tournament operations:
 * - List tournaments
 * - Get tournament details
 * - Register/unregister
 * - View leaderboard
 * - Propose a user-hosted tournament (awaits admin approval)
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

    // Draft/pending-review/rejected tournaments aren't other users' business —
    // only the proposer (if any) and admins can view them by direct ID.
    const NON_PUBLIC_STATUSES = ['draft', 'pending_review', 'rejected'];
    if (NON_PUBLIC_STATUSES.includes(tournament.status) && !isAdmin && tournament.proposedBy !== userId) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

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

    const QuizCategory = require('../models/QuizCategory');
    const category = tournament.categoryId
      ? await QuizCategory.findByPk(tournament.categoryId, { attributes: ['name'] })
      : null;

    return res.status(200).json({
      success: true,
      tournament: {
        ...tournament.toJSON(),
        categoryName: category?.name || null,
        currentParticipants: tournament.participants ? tournament.participants.length : 0,
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
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection?.remoteAddress || null;

    const result = await tournamentService.registerParticipant(tournamentId, userId, { ip });

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
 * Voluntarily forfeit an in-progress tournament. For knockout this forfeits
 * the participant's live match (opponent advances); for shared-question
 * formats it just removes them from the active pool so the round doesn't
 * wait on them. This is the deliberate-click counterpart to the automatic
 * disconnect-triggered forfeit in websocketManager.
 * POST /api/quiz/tournament/:id/forfeit
 */
exports.forfeitTournament = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: tournamentId } = req.params;

    const result = await tournamentService.forfeitTournament(tournamentId, userId);

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.reason || 'Could not forfeit tournament' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Quiz Tournament Controller] Forfeit tournament error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to forfeit tournament'
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

/**
 * Propose a user-hosted tournament — enters 'pending_review' and only
 * becomes visible/joinable once an admin approves it.
 * POST /api/quiz/tournament/propose
 */
exports.proposeTournament = async (req, res) => {
  try {
    const userId = req.user.id;
    const config = req.body;

    const result = await tournamentService.proposeTournament(userId, config);

    return res.status(201).json(result);
  } catch (error) {
    console.error('[Quiz Tournament Controller] Propose tournament error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to propose tournament'
    });
  }
};

/**
 * Get tournaments the current user is involved in — registered for,
 * proposed, or has an entry in the past.
 * GET /api/quiz/tournament/mine
 */
exports.getMyTournaments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const QuizTournamentParticipant = require('../models/QuizTournamentParticipant');
    const QuizTournament = require('../models/QuizTournament');

    const [participations, proposals] = await Promise.all([
      QuizTournamentParticipant.findAll({
        where: { userId },
        include: [{ model: QuizTournament, as: 'tournament' }],
        order: [['registeredAt', 'DESC']],
        limit: parseInt(limit),
        offset
      }),
      QuizTournament.findAll({
        where: { proposedBy: userId },
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit)
      })
    ]);

    return res.status(200).json({
      success: true,
      participations: participations.map(p => ({
        tournamentId: p.tournamentId,
        tournament: p.tournament,
        status: p.status,
        currentRound: p.currentRound,
        totalScore: p.totalScore,
        placement: p.placement,
        prizeWon: p.prizeWon,
        registeredAt: p.registeredAt
      })),
      proposals
    });
  } catch (error) {
    console.error('[Quiz Tournament Controller] Get my tournaments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get your tournaments'
    });
  }
};

/**
 * Get details for a specific round — questions (without correct answers,
 * once the round has started), status, and current standings.
 * GET /api/quiz/tournament/:id/round/:roundNumber
 */
exports.getRoundDetail = async (req, res) => {
  try {
    const { id: tournamentId, roundNumber } = req.params;
    const userId = req.user.id;

    const QuizTournamentRound = require('../models/QuizTournamentRound');
    const QuizTournamentParticipant = require('../models/QuizTournamentParticipant');
    const questionService = require('../services/questionService');

    const [round, participant] = await Promise.all([
      QuizTournamentRound.findOne({ where: { tournamentId, roundNumber: parseInt(roundNumber) } }),
      QuizTournamentParticipant.findOne({ where: { tournamentId, userId } })
    ]);

    if (!round) {
      return res.status(404).json({ success: false, message: 'Round not found' });
    }
    if (!participant) {
      return res.status(403).json({ success: false, message: 'You are not a participant in this tournament' });
    }

    const questionsForClient = [];
    for (const qId of round.questions || []) {
      const q = await questionService.getQuestionById(qId);
      if (q) {
        questionsForClient.push({ id: q.id, questionText: q.questionText, options: q.options, difficulty: q.difficulty });
      }
    }

    return res.status(200).json({
      success: true,
      round: {
        roundNumber: round.roundNumber,
        status: round.status,
        questions: questionsForClient,
        participants: round.participants,
        startedAt: round.startedAt,
        completedAt: round.completedAt
      },
      myEntry: round.participants.find(p => p.userId === userId) || null
    });
  } catch (error) {
    console.error('[Quiz Tournament Controller] Get round detail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get round detail'
    });
  }
};

module.exports = exports;
