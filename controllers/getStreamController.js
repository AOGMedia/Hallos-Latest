const { LiveClass, LiveHost } = require('../models/liveIndex');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const { getStreamService, GetStreamError } = require('../services/getStreamService');
// Shared access rules (privacy, invitation codes, co-hosts). Only read here;
// the ZegoCloud controller is not changed.
const { enforcePrivacySettings } = require('./zegoCloudController');

/**
 * GetStream live class endpoints. Mirrors the ZegoCloud ones (start / join /
 * end / heartbeat) so the frontend flows match, plus recording controls.
 * Mounted under /live — see routes/getStreamRoutes.js.
 */

const handleError = (res, error, fallback) => {
  if (error instanceof GetStreamError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code });
  }
  console.error(`[GetStream Controller] ${fallback}:`, error);
  return res.status(502).json({ success: false, message: fallback });
};

/** Loads the class and checks it's a GetStream class; sends the error response if not. */
const loadGetStreamClass = async (req, res) => {
  const liveClass = await LiveClass.findByPk(req.params.id);
  if (!liveClass) {
    res.status(404).json({ success: false, message: 'Live class not found' });
    return null;
  }
  if (liveClass.streaming_provider !== 'getstream') {
    res.status(400).json({ success: false, message: 'This live class is not configured for GetStream streaming' });
    return null;
  }
  return liveClass;
};

const requireCreator = (liveClass, req, res, action) => {
  if (liveClass.userId !== req.user.id) {
    res.status(403).json({ success: false, message: `Only the creator can ${action}` });
    return false;
  }
  return true;
};

/** Same rule as checkZegoCloudAccess: free, the creator, or a completed purchase. */
const hasPaidAccess = async (liveClass, userId) => {
  if (parseFloat(liveClass.price) === 0) return true;
  if (liveClass.userId === userId) return true;
  const purchase = await Purchase.findOne({
    where: { userId, contentType: 'live_class', contentId: liveClass.id, paymentStatus: 'completed' }
  });
  return Boolean(purchase);
};

/**
 * Start a GetStream live session (creator only).
 * POST /live/:id/start-getstream
 */
exports.startSession = async (req, res) => {
  try {
    const liveClass = await loadGetStreamClass(req, res);
    if (!liveClass || !requireCreator(liveClass, req, res, 'start the live session')) return;

    const creator = await User.findByPk(req.user.id);
    const result = await getStreamService.startSession(liveClass, creator || { id: req.user.id });

    return res.status(200).json({
      success: true,
      message: result.alreadyLive ? 'Live class is already active' : 'GetStream live session started successfully',
      data: { ...result, userType: 'creator', liveClass: { id: liveClass.id, title: liveClass.title } }
    });
  } catch (error) {
    return handleError(res, error, 'Failed to start live session');
  }
};

/**
 * Join a live GetStream class. Same access rules as ZegoCloud's join-room.
 * POST /live/:id/join-getstream  { invitationCode? }
 */
exports.joinSession = async (req, res) => {
  try {
    const liveClass = await loadGetStreamClass(req, res);
    if (!liveClass) return;

    const userId = req.user.id;
    const { invitationCode } = req.body || {};
    const isCreator = liveClass.userId === userId;
    const hostRecord = isCreator
      ? null
      : await LiveHost.findOne({ where: { liveClassId: liveClass.id, userId } });
    const isCohost = Boolean(hostRecord);

    if (!isCreator && !isCohost) {
      const paid = await hasPaidAccess(liveClass, userId);
      const access = await enforcePrivacySettings(liveClass, userId, invitationCode, paid);
      if (!access.allowed) {
        return res.status(access.statusCode).json({
          success: false,
          message: access.message,
          code: access.code,
          ...(access.code === 'PAYMENT_REQUIRED'
            ? {
                requiresPayment: true,
                price: liveClass.price,
                amount: liveClass.price,
                currency: liveClass.currency || 'NGN',
                contentType: 'live_class',
                contentId: liveClass.id
              }
            : {})
        });
      }
    }

    const user = await User.findByPk(userId);
    const credentials = await getStreamService.joinSession(liveClass, user || { id: userId }, {
      isHost: isCreator || isCohost
    });

    return res.status(200).json({
      success: true,
      message: 'Successfully joined live class',
      data: {
        ...credentials,
        userType: isCreator ? 'creator' : isCohost ? 'cohost' : 'participant',
        userName: user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() : '',
        liveClass: { id: liveClass.id, title: liveClass.title }
      }
    });
  } catch (error) {
    return handleError(res, error, 'Failed to join live class');
  }
};

/**
 * End the class for everyone (creator only).
 * POST /live/:id/end-getstream
 */
exports.endSession = async (req, res) => {
  try {
    const liveClass = await loadGetStreamClass(req, res);
    if (!liveClass || !requireCreator(liveClass, req, res, 'end the live session')) return;

    const result = await getStreamService.endSession(liveClass);
    return res.status(200).json({ success: true, message: 'GetStream live session ended successfully', data: result });
  } catch (error) {
    return handleError(res, error, 'Failed to end live session');
  }
};

/**
 * Host heartbeat — same recovery as ZegoCloud (services/liveRecoveryService).
 * POST /live/:id/heartbeat-getstream  { callId }
 */
exports.heartbeat = async (req, res) => {
  try {
    const liveClass = await loadGetStreamClass(req, res);
    if (!liveClass || !requireCreator(liveClass, req, res, 'send a host heartbeat')) return;

    const { applyHostHeartbeat } = require('../services/liveRecoveryService');
    const result = await applyHostHeartbeat(liveClass, (req.body || {}).callId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'Failed to record heartbeat');
  }
};

/**
 * Start or stop recording (creator only).
 * POST /live/:id/recording-getstream  { action: 'start' | 'stop' }
 */
exports.setRecording = async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!['start', 'stop'].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'start' or 'stop'" });
    }
    const liveClass = await loadGetStreamClass(req, res);
    if (!liveClass || !requireCreator(liveClass, req, res, 'control recording')) return;

    const result = await getStreamService.setRecording(liveClass, action);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, 'Failed to update recording');
  }
};

/**
 * Recordings of every session of the class (creator and co-hosts).
 * GET /live/:id/recordings-getstream
 */
exports.listRecordings = async (req, res) => {
  try {
    const liveClass = await loadGetStreamClass(req, res);
    if (!liveClass) return;

    if (liveClass.userId !== req.user.id) {
      const host = await LiveHost.findOne({ where: { liveClassId: liveClass.id, userId: req.user.id } });
      if (!host) {
        return res.status(403).json({ success: false, message: 'Only the creator can view recordings' });
      }
    }

    const recordings = await getStreamService.listRecordings(liveClass);
    return res.status(200).json({ success: true, data: { recordings } });
  } catch (error) {
    return handleError(res, error, 'Failed to load recordings');
  }
};
