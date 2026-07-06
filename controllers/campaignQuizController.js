const campaignQuizService = require('../services/campaignQuizService');
const CampaignQuizSession = require('../models/CampaignQuizSession');
const CampaignQuizAnswer = require('../models/CampaignQuizAnswer');
const CampaignRegistration = require('../models/CampaignRegistration');
const { Op } = require('sequelize');

// ── PARTICIPANT ENDPOINTS ──────────────────────────────────────────────────────

/**
 * Start or resume a quiz session
 * GET /api/campaigns/quiz/:token/start
 * Requires: auth (JWT)
 */
exports.startSession = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const result = await campaignQuizService.startSession(token, userId);

    return res.status(200).json({
      success: true,
      message: 'Quiz session started. Good luck!',
      ...result
    });
  } catch (err) {
    if (err.alreadyCompleted) {
      return res.status(409).json({ success: false, message: err.message, alreadyCompleted: true });
    }
    if (err.expired) {
      return res.status(410).json({ success: false, message: err.message, expired: true });
    }
    console.error('[CampaignQuiz] startSession error:', err.message);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * Submit one answer
 * POST /api/campaigns/quiz/:token/answer
 * Body: { questionId, questionIndex, selectedAnswer, clientTimestamp }
 * Requires: auth (JWT)
 */
exports.submitAnswer = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;
    const { questionId, questionIndex, selectedAnswer, clientTimestamp } = req.body;

    if (questionId === undefined || questionIndex === undefined || !selectedAnswer) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: questionId, questionIndex, selectedAnswer'
      });
    }

    if (typeof questionIndex !== 'number' || questionIndex < 0 || questionIndex > 19) {
      return res.status(400).json({ success: false, message: 'questionIndex must be 0–19' });
    }

    const result = await campaignQuizService.submitAnswer(token, userId, {
      questionId,
      questionIndex,
      selectedAnswer,
      clientTimestamp
    });

    return res.status(200).json({
      success: true,
      message: result.timedOut ? 'Time expired — question marked as unanswered.' : 'Answer recorded.',
      answersSubmitted: result.answersSubmitted,
      totalQuestions: result.totalQuestions,
      timedOut: result.timedOut
    });
  } catch (err) {
    console.error('[CampaignQuiz] submitAnswer error:', err.message);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * Submit / close the quiz
 * POST /api/campaigns/quiz/:token/submit
 * Requires: auth (JWT)
 */
exports.submitQuiz = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const result = await campaignQuizService.submitQuiz(token, userId);

    // Fire results email asynchronously — don't block the response
    (async () => {
      try {
        const session = await CampaignQuizSession.findOne({ where: { accessToken: token } });
        if (session && !session.resultEmailSent) {
          const registration = await CampaignRegistration.findByPk(session.registrationId);
          if (registration) {
            const { sendCampaignQuizResultsEmail } = require('../utils/email');
            await sendCampaignQuizResultsEmail(session.email, registration.firstName, {
              lastName: registration.lastName,
              score: result.score,
              totalQuestions: result.totalQuestions,
              totalTimeMs: result.totalTimeMs,
              totalCorrect: result.totalCorrect
            });
            await session.update({ resultEmailSent: true });
          }
        }
      } catch (emailErr) {
        console.error('[CampaignQuiz] Results email failed:', emailErr.message);
      }
    })();

    return res.status(200).json({
      success: true,
      message: 'Quiz submitted! Check your email for your results.',
      score: result.score,
      totalCorrect: result.totalCorrect,
      totalQuestions: result.totalQuestions,
      totalTimeMs: result.totalTimeMs
    });
  } catch (err) {
    console.error('[CampaignQuiz] submitQuiz error:', err.message);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * Get session status (for refresh / re-entry detection)
 * GET /api/campaigns/quiz/:token/status
 * Requires: auth (JWT)
 */
exports.getSessionStatus = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const result = await campaignQuizService.getSessionStatus(token, userId);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err.expired) {
      return res.status(410).json({ success: false, message: err.message, expired: true });
    }
    console.error('[CampaignQuiz] getSessionStatus error:', err.message);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────

/**
 * Get campaign quiz leaderboard / results
 * GET /api/campaigns/quiz/admin/results
 * Query: ?status=completed&page=1&limit=50&search=email
 * Requires: auth + admin
 */
exports.getResults = async (req, res) => {
  try {
    const { status, page = 1, limit = 50, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const sessionWhere = {};
    if (status && ['pending', 'active', 'completed', 'expired'].includes(status)) {
      sessionWhere.status = status;
    }
    if (search) {
      sessionWhere.email = { [Op.iLike]: `%${search}%` };
    }

    const { count, rows } = await CampaignQuizSession.findAndCountAll({
      where: sessionWhere,
      include: [{
        model: CampaignRegistration,
        as: 'registration',
        foreignKey: 'registrationId',
        attributes: ['firstName', 'lastName', 'talent', 'location', 'phoneNumber']
      }],
      order: [
        ['score', 'DESC NULLS LAST'],
        ['total_time_ms', 'ASC NULLS LAST'],
        ['completed_at', 'ASC NULLS LAST']
      ],
      limit: parseInt(limit),
      offset,
      attributes: [
        'id', 'email', 'userId', 'status', 'score', 'totalCorrect',
        'totalTimeMs', 'startedAt', 'completedAt', 'tokenExpiresAt', 'resultEmailSent'
      ]
    });

    const results = rows.map((row, idx) => ({
      rank: offset + idx + 1,
      email: row.email,
      firstName: row.registration?.firstName,
      lastName: row.registration?.lastName,
      talent: row.registration?.talent,
      location: row.registration?.location,
      status: row.status,
      score: row.score,
      totalCorrect: row.totalCorrect,
      totalTimeMs: row.totalTimeMs,
      completedAt: row.completedAt,
      tokenExpiresAt: row.tokenExpiresAt
    }));

    return res.status(200).json({
      success: true,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      results
    });
  } catch (err) {
    console.error('[CampaignQuiz] getResults error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch quiz results' });
  }
};

/**
 * Send quiz access links to all paid registrants who don't have a session yet
 * POST /api/campaigns/quiz/admin/send-links
 * Body: { registrationIds?: string[] }  — optional; if omitted, targets ALL paid without sessions
 * Requires: auth + admin
 */
exports.sendQuizLinks = async (req, res) => {
  try {
    const { registrationIds } = req.body;
    const { createQuizSession } = require('../services/campaignQuizService');
    const { sendCampaignQuizAccessEmail } = require('../utils/email');

    // Find paid registrants without a quiz session
    const where = { paymentStatus: 'completed' };
    if (registrationIds && Array.isArray(registrationIds) && registrationIds.length > 0) {
      where.id = { [Op.in]: registrationIds };
    }

    const registrations = await CampaignRegistration.findAll({ where });

    // Filter out those that already have sessions
    const existingSessions = await CampaignQuizSession.findAll({
      where: { registrationId: { [Op.in]: registrations.map(r => r.id) } },
      attributes: ['registrationId']
    });
    const alreadyHasSession = new Set(existingSessions.map(s => s.registrationId));

    const toProcess = registrations.filter(r => !alreadyHasSession.has(r.id));

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const reg of toProcess) {
      try {
        const { token } = await createQuizSession(reg.id, reg.email);
        await sendCampaignQuizAccessEmail(reg.email, reg.firstName, {
          lastName: reg.lastName,
          token,
          talent: reg.talent,
          location: reg.location
        });
        await CampaignRegistration.update({ emailSent: true }, { where: { id: reg.id } });
        sent++;
      } catch (err) {
        failed++;
        errors.push({ email: reg.email, error: err.message });
        console.error(`[CampaignQuiz] sendQuizLinks failed for ${reg.email}:`, err.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Quiz links sent: ${sent}. Failed: ${failed}. Already had session: ${alreadyHasSession.size}.`,
      sent,
      failed,
      alreadyHadSession: alreadyHasSession.size,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('[CampaignQuiz] sendQuizLinks error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to send quiz links' });
  }
};

/**
 * Get detailed answers for one session (admin investigation)
 * GET /api/campaigns/quiz/admin/session/:sessionId/answers
 * Requires: auth + admin
 */
exports.getSessionAnswers = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await CampaignQuizSession.findByPk(sessionId, {
      include: [{
        model: CampaignRegistration,
        as: 'registration',
        foreignKey: 'registrationId',
        attributes: ['firstName', 'lastName', 'email', 'talent', 'location']
      }]
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const answers = await CampaignQuizAnswer.findAll({
      where: { sessionId },
      order: [['question_index', 'ASC']]
    });

    return res.status(200).json({
      success: true,
      session: {
        id: session.id,
        email: session.email,
        status: session.status,
        score: session.score,
        totalCorrect: session.totalCorrect,
        totalTimeMs: session.totalTimeMs,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        participant: session.registration
      },
      answers: answers.map(a => ({
        questionIndex: a.questionIndex,
        questionId: a.questionId,
        selectedAnswer: a.selectedAnswer,
        isCorrect: a.isCorrect,
        responseTimeMs: a.responseTimeMs
      }))
    });
  } catch (err) {
    console.error('[CampaignQuiz] getSessionAnswers error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch session answers' });
  }
};
