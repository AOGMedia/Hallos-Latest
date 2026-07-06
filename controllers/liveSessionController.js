const { LiveSeries, LiveSession } = require('../models/liveSeriesIndex');
const liveSeriesService = require('../services/liveSeriesService');
const { zegoCloudService } = require('../services/zegoCloudService');
const User = require('../models/User');

/**
 * Start a session (creator only)
 * POST /api/live/session/:id/start
 */
exports.startSession = async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user.id;
    
    // Get session with series
    const session = await LiveSession.findByPk(sessionId, {
      include: [{
        model: LiveSeries,
        as: 'series'
      }]
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check if user is the creator
    if (session.series.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can start this session'
      });
    }
    
    // Check if session can be started
    if (!session.canStart()) {
      return res.status(400).json({
        success: false,
        message: `Session cannot be started. Current status: ${session.status}`
      });
    }
    
    // Check if series is active
    if (session.series.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Series is not active'
      });
    }
    
    // Create ZegoCloud room
    const roomResult = await zegoCloudService.createRoom(
      sessionId,
      userId,
      {
        privacy: session.series.privacy,
        maxParticipants: session.series.maxParticipants
      }
    );
    
    // Update session
    await session.update({
      zegoRoomId: roomResult.roomId,
      zegoAppId: roomResult.appId,
      status: 'live',
      actualStartTime: new Date()
    });
    
    console.log(`[Live Session Controller] Session ${sessionId} started by user ${userId}`);
    
    return res.status(200).json({
      success: true,
      message: 'Session started successfully',
      data: {
        sessionId: session.id,
        sessionNumber: session.sessionNumber,
        roomId: roomResult.roomId,
        appId: roomResult.appId,
        creatorToken: roomResult.creatorToken,
        series: {
          id: session.series.id,
          title: session.series.title
        }
      }
    });
    
  } catch (error) {
    console.error('[Live Session Controller] Start session error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start session',
      error: error.message
    });
  }
};

/**
 * End a session (creator only)
 * POST /api/live/session/:id/end
 */
exports.endSession = async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user.id;
    
    // Get session with series
    const session = await LiveSession.findByPk(sessionId, {
      include: [{
        model: LiveSeries,
        as: 'series'
      }]
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check if user is the creator
    if (session.series.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can end this session'
      });
    }
    
    // Check if session is live
    if (session.status !== 'live') {
      return res.status(400).json({
        success: false,
        message: 'Session is not currently live'
      });
    }
    
    // End ZegoCloud session
    if (session.zegoRoomId) {
      await zegoCloudService.deleteRoom(session.zegoRoomId);
    }
    
    // Update session
    await session.update({
      status: 'ended',
      actualEndTime: new Date()
    });
    
    console.log(`[Live Session Controller] Session ${sessionId} ended by user ${userId}`);
    
    return res.status(200).json({
      success: true,
      message: 'Session ended successfully',
      data: {
        sessionId: session.id,
        sessionNumber: session.sessionNumber,
        endedAt: session.actualEndTime
      }
    });
    
  } catch (error) {
    console.error('[Live Session Controller] End session error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to end session',
      error: error.message
    });
  }
};

/**
 * Join a session (students)
 * POST /api/live/session/:id/join
 */
exports.joinSession = async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user.id;
    
    // Get session with series
    const session = await LiveSession.findByPk(sessionId, {
      include: [{
        model: LiveSeries,
        as: 'series'
      }]
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check if session is live
    if (!session.canJoin()) {
      return res.status(400).json({
        success: false,
        message: 'Session is not currently live or room not available'
      });
    }
    
    // Check if user has access to the series
    const hasAccess = await liveSeriesService.checkSeriesAccess(userId, session.seriesId);
    
    if (!hasAccess) {
      return res.status(402).json({
        success: false,
        message: 'Payment required to access this series',
        requiresPayment: true,
        price: session.series.price,
        currency: session.series.currency
      });
    }
    
    // Get user information
    const user = await User.findByPk(userId);
    const userInfo = {
      displayName: user ? `${user.firstname} ${user.lastname}`.trim() : `User ${userId}`,
      avatar: user ? user.avatar : null,
      email: user ? user.email : null
    };
    
    // Determine role
    const role = session.series.userId === userId ? 'host' : 'participant';
    
    // Generate ZegoCloud token
    const token = zegoCloudService.generateToken(
      session.zegoRoomId,
      userId,
      role
    );
    
    console.log(`[Live Session Controller] User ${userId} joined session ${sessionId}`);
    
    return res.status(200).json({
      success: true,
      message: 'Successfully joined session',
      data: {
        sessionId: session.id,
        sessionNumber: session.sessionNumber,
        roomId: session.zegoRoomId,
        appId: session.zegoAppId,
        token: token,
        role: role,
        userInfo: userInfo,
        session: {
          scheduledStartTime: session.scheduledStartTime,
          scheduledEndTime: session.scheduledEndTime
        },
        series: {
          id: session.series.id,
          title: session.series.title,
          description: session.series.description
        }
      }
    });
    
  } catch (error) {
    console.error('[Live Session Controller] Join session error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to join session',
      error: error.message
    });
  }
};

/**
 * Get session by ID
 * GET /api/live/session/:id
 */
exports.getSessionById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const session = await LiveSession.findByPk(id, {
      include: [{
        model: LiveSeries,
        as: 'series',
        include: [{
          model: User,
          as: 'creator',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }]
      }]
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check if user has access (optional authentication)
    let hasAccess = false;
    let accessReason = null;
    const price = parseFloat(session.series.price);
    
    // Check if free
    if (price === 0) {
      hasAccess = true;
      accessReason = 'free_content';
    }
    
    // Check if user is authenticated and has access
    if (req.user && !hasAccess) {
      hasAccess = await liveSeriesService.checkSeriesAccess(req.user.id, session.seriesId);
      if (hasAccess) {
        // Determine access reason
        if (session.series.userId === req.user.id) {
          accessReason = 'creator';
        } else {
          accessReason = 'purchased';
        }
      }
    }
    
    return res.json({
      success: true,
      session: {
        ...session.dataValues,
        hasAccess,
        accessReason,
        requiresPayment: !hasAccess && price > 0
      }
    });
    
  } catch (error) {
    console.error('[Live Session Controller] Get session by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch session details'
    });
  }
};

/**
 * Get upcoming sessions for user
 * GET /api/live/session/upcoming
 */
exports.getUpcomingSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;
    
    // Get all series user has purchased
    const Purchase = require('../models/Purchase');
    const purchases = await Purchase.findAll({
      where: {
        userId,
        contentType: 'live_series',
        paymentStatus: 'completed'
      }
    });
    
    const seriesIds = purchases.map(p => p.contentId);
    
    // Get upcoming sessions for these series
    const { Op } = require('sequelize');
    const upcomingSessions = await LiveSession.findAll({
      where: {
        seriesId: {
          [Op.in]: seriesIds
        },
        status: 'scheduled',
        scheduledStartTime: {
          [Op.gte]: new Date()
        }
      },
      order: [['scheduledStartTime', 'ASC']],
      limit: parseInt(limit),
      include: [{
        model: LiveSeries,
        as: 'series',
        attributes: ['id', 'title', 'thumbnailUrl', 'userId']
      }]
    });
    
    return res.json({
      success: true,
      count: upcomingSessions.length,
      sessions: upcomingSessions
    });
    
  } catch (error) {
    console.error('[Live Session Controller] Get upcoming sessions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming sessions'
    });
  }
};

module.exports = exports;
