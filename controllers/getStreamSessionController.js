const { LiveSeries, LiveSession } = require('../models/liveSeriesIndex');
const liveSeriesService = require('../services/liveSeriesService');
const User = require('../models/User');
const { getStreamService, GetStreamError } = require('../services/getStreamService');
const { seriesProviderOf } = require('../utils/liveProviders');

/**
 * GetStream endpoints for live series sessions. Same rules as the ZegoCloud
 * session endpoints (controllers/liveSessionController.js): the series creator
 * starts and ends a session; anyone with series access (creator, free series,
 * or a purchase) can join while it's live.
 * Mounted under /api/live/series — see routes/getStreamSeriesRoutes.js.
 */

const handleError = (res, error, fallback) => {
  if (error instanceof GetStreamError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code });
  }
  console.error(`[GetStream Session Controller] ${fallback}:`, error);
  return res.status(502).json({ success: false, message: fallback });
};

/** Loads the session (with its series) and checks it's a GetStream series. */
const loadGetStreamSession = async (req, res) => {
  const session = await LiveSession.findByPk(req.params.id, { include: [{ model: LiveSeries, as: 'series' }] });
  if (!session) {
    res.status(404).json({ success: false, message: 'Session not found' });
    return null;
  }
  if (seriesProviderOf(session.series) !== 'getstream') {
    res.status(400).json({ success: false, message: 'This series is not configured for GetStream streaming' });
    return null;
  }
  return session;
};

const requireCreator = (session, req, res, action) => {
  if (session.series.userId !== req.user.id) {
    res.status(403).json({ success: false, message: `Only the creator can ${action}` });
    return false;
  }
  return true;
};

const sessionTitle = (session) => `${session.series.title} - Session ${session.sessionNumber}`;

/**
 * POST /api/live/series/session/:id/start-getstream
 */
exports.startSession = async (req, res) => {
  try {
    const session = await loadGetStreamSession(req, res);
    if (!session || !requireCreator(session, req, res, 'start this session')) return;

    if (session.status === 'scheduled' && session.series.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Series is not active' });
    }

    const creator = await User.findByPk(req.user.id);
    const result = await getStreamService.startSeriesSession(session, session.series, creator || { id: req.user.id });

    return res.status(200).json({
      success: true,
      message: result.alreadyLive ? 'Session is already live' : 'Session started successfully',
      data: { ...result, userType: 'creator', liveClass: { id: session.id, title: sessionTitle(session) } }
    });
  } catch (error) {
    return handleError(res, error, 'Failed to start session');
  }
};

/**
 * POST /api/live/series/session/:id/join-getstream
 */
exports.joinSession = async (req, res) => {
  try {
    const session = await loadGetStreamSession(req, res);
    if (!session) return;

    const userId = req.user.id;
    const isCreator = session.series.userId === userId;
    if (!isCreator) {
      const hasAccess = await liveSeriesService.checkSeriesAccess(userId, session.seriesId);
      if (!hasAccess) {
        return res.status(402).json({
          success: false,
          message: 'Payment required to access this series',
          requiresPayment: true,
          price: session.series.price,
          amount: session.series.price,
          currency: session.series.currency
        });
      }
    }

    const user = await User.findByPk(userId);
    const credentials = await getStreamService.joinSeriesSession(session, user || { id: userId }, { isHost: isCreator });

    return res.status(200).json({
      success: true,
      message: 'Successfully joined session',
      data: {
        ...credentials,
        userType: isCreator ? 'creator' : 'participant',
        userName: user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() : '',
        liveClass: { id: session.id, title: sessionTitle(session) }
      }
    });
  } catch (error) {
    return handleError(res, error, 'Failed to join session');
  }
};

/**
 * POST /api/live/series/session/:id/end-getstream
 */
exports.endSession = async (req, res) => {
  try {
    const session = await loadGetStreamSession(req, res);
    if (!session || !requireCreator(session, req, res, 'end this session')) return;

    const result = await getStreamService.endSeriesSession(session);
    return res.status(200).json({ success: true, message: 'Session ended successfully', data: result });
  } catch (error) {
    return handleError(res, error, 'Failed to end session');
  }
};

/**
 * POST /api/live/series/session/:id/recording-getstream  { action: 'start' | 'stop' }
 */
exports.setRecording = async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!['start', 'stop'].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'start' or 'stop'" });
    }
    const session = await loadGetStreamSession(req, res);
    if (!session || !requireCreator(session, req, res, 'control recording')) return;

    const result = await getStreamService.setSeriesSessionRecording(session, action);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'Failed to update recording');
  }
};

/**
 * GET /api/live/series/session/:id/recordings-getstream  (creator only)
 */
exports.listRecordings = async (req, res) => {
  try {
    const session = await loadGetStreamSession(req, res);
    if (!session || !requireCreator(session, req, res, 'view recordings')) return;

    const recordings = await getStreamService.listSeriesSessionRecordings(session);
    return res.status(200).json({ success: true, data: { recordings } });
  } catch (error) {
    return handleError(res, error, 'Failed to load recordings');
  }
};
