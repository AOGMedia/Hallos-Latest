const { LiveClass, LiveHost, LiveAttendee } = require('../models/liveIndex');
const muxLiveService = require('../services/muxLiveService');
const User = require('../models/User');

// --- HELPER: Centralized Error Handler ---
// This translates database/code errors into Frontend-friendly messages
const handleError = (res, error) => {
  console.error("❌ Backend Error:", error); // Keep logs for yourself

  // 1. Sequelize Validation Errors (e.g. Missing fields, Wrong ENUM values)
  if (error.name === 'SequelizeValidationError') {
    const messages = error.errors.map(e => e.message);
    return res.status(400).json({ 
      success: false, 
      message: 'Validation Error', 
      errors: messages // Returns ["Status must be 'scheduled'", "Title is required"]
    });
  }

  // 2. Database/Enum Errors (Postgres specific)
  if (error.name === 'SequelizeDatabaseError') {
    // Detect invalid input syntax for types (like UUIDs or Enums)
    if (error.parent && error.parent.code === '22P02') {
       return res.status(400).json({ success: false, message: 'Invalid data format provided (check UUIDs or Enums).' });
    }
    // Handle ENUM violations that bypass Sequelize validation
    if (error.message.includes('invalid input value for enum')) {
       return res.status(400).json({ success: false, message: 'Invalid value provided for an enum field.' });
    }
  }

  // 3. Unique Constraint Errors (e.g. User already registered)
  if (error.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ success: false, message: 'Duplicate entry: This record already exists.' });
  }

  // 4. Mux Service Errors
  if (error.name === 'MuxError' || (error.status && error.status >= 400 && error.status < 500)) {
     return res.status(error.status || 502).json({ success: false, message: `Video Service Error: ${error.message}` });
  }

  // 5. Default Server Error
  return res.status(500).json({ success: false, message: 'Internal Server Error. Please try again later.' });
};


exports.createLiveClass = async (req, res) => {
  try {
    const { title, description, price, currency, category, thumbnailUrl, startTime, endTime, privacy, streamingProvider = 'mux' } = req.body;
    const userId = req.user.id;
    
    // Handle thumbnail - either from file upload or URL string
    // Check multiple possible field names (thumbnail, thumbnailUrl, image, file)
    const thumbnailFile = req.files?.thumbnail?.[0] || req.files?.thumbnailUrl?.[0] || req.files?.image?.[0] || req.files?.file?.[0];
    // S3 uploads have 'location' property, local uploads have 'filename'
    const finalThumbnailUrl = thumbnailFile 
      ? (thumbnailFile.location || `/upload/${thumbnailFile.filename}`)
      : thumbnailUrl || null; 

    // Basic check before calling services
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    // Validate currency if provided
    const validCurrencies = ['NGN', 'USD'];
    const finalCurrency = currency && validCurrencies.includes(currency.toUpperCase()) 
      ? currency.toUpperCase() 
      : 'NGN';

    // Validate streaming provider
    if (!['mux', 'zegocloud'].includes(streamingProvider)) {
      return res.status(400).json({ success: false, message: "Invalid streaming provider. Must be 'mux' or 'zegocloud'" });
    }

    let streamingDetails = {};

    if (streamingProvider === 'zegocloud') {
      // Step 1b: Prepare for ZegoCloud (room will be created when going live)
      streamingDetails = {
        streaming_provider: 'zegocloud',
        // ZegoCloud fields will be populated when creator starts the live session
        zego_room_id: null,
        zego_app_id: null,
        zego_room_token: null,
        max_participants: req.body.maxParticipants || 200
      };
    }
    
    else if (streamingProvider === 'mux') {
      // Step 1a: Create Mux live stream
      const muxDetails = await muxLiveService.createLiveStream({ title, passthrough: '' });
      streamingDetails = {
        streaming_provider: 'mux',
        mux_stream_id: muxDetails.mux_stream_id,
        mux_stream_key: muxDetails.mux_stream_key,
        mux_rtmp_url: muxDetails.mux_rtmp_url,
        mux_playback_id: muxDetails.mux_playback_id
      };
    } 

    // Step 2: Create LiveClass row
    const liveClass = await LiveClass.create({
      userId,
      title,
      description,
      price,
      currency: finalCurrency,
      category,
      thumbnailUrl: finalThumbnailUrl,
      startTime,
      endTime,
      privacy,
      status: 'scheduled', // Ensure this matches your Enum definition exactly
      ...streamingDetails
    });

    // Step 3: Add creator as primary host
    await LiveHost.create({
      liveClassId: liveClass.id,
      userId,
      role: 'creator'
    });

    return res.json({ 
      success: true, 
      liveClass: {
        ...liveClass.dataValues,
        // Include helpful info for frontend
        streamingProvider: liveClass.streaming_provider,
        isZegoCloud: liveClass.streaming_provider === 'zegocloud',
        isMux: liveClass.streaming_provider === 'mux',
        pricing: liveClass.getDualPricing()
      }
    });

    // Queue digest notifications in background (fire-and-forget)
    setImmediate(async () => {
      try {
        const audienceService = require('../services/audienceService');
        await audienceService.queueDigestItems(liveClass, 'live_class');
      } catch (e) {
        console.error('[Live Controller] Failed to queue digest items:', e.message);
      }
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.addHost = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.body;

    // Check constraint manually to return clean message
    const exists = await LiveHost.findOne({ where: { liveClassId: id, userId } });
    if (exists) return res.status(400).json({ message: 'Host already exists.' });

    const host = await LiveHost.create({
      liveClassId: id,
      userId,
      role: role || 'cohost'
    });
    return res.json({ success: true, host });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.addAttendee = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, invitedBy, statusPaid } = req.body;

    const attendee = await LiveAttendee.create({
      liveClassId: id,
      userId,
      invitedBy: invitedBy || null,
      statusPaid: statusPaid || false
    });
    return res.json({ success: true, attendee });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getLiveClassById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get live class with creator info
    const User = require('../models/User');
    const live = await LiveClass.findByPk(id, {
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'firstname', 'lastname', 'email']
      }]
    });
    
    if (!live) {
      return res.status(404).json({ 
        success: false,
        message: 'Live class not found.' 
      });
    }

    // Extract user from token (optional authentication)
    const extractUserFromToken = (req) => {
      try {
        const jwt = require('jsonwebtoken');
        let token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token && req.cookies && req.cookies.token) {
          token = req.cookies.token;
        }
        if (!token) return null;
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        return decoded;
      } catch (error) {
        return null;
      }
    };

    const user = req.user || extractUserFromToken(req);
    const userId = user ? user.id : null;

    // Check access (free content, creator, or purchased)
    let hasAccess = false;
    let accessReason = null;
    let purchaseDate = null;

    const price = parseFloat(live.price);
    
    // Check if free
    if (price === 0) {
      hasAccess = true;
      accessReason = 'free_content';
    }
    
    // Check if creator
    if (userId && live.userId && live.userId === userId) {
      hasAccess = true;
      accessReason = 'creator';
    }
    
    // Check if co-host
    if (userId && !hasAccess) {
      const { LiveHost } = require('../models/liveIndex');
      const isHost = await LiveHost.findOne({
        where: {
          liveClassId: id,
          userId: userId
        }
      });

      if (isHost) {
        hasAccess = true;
        accessReason = isHost.role === 'creator' ? 'creator' : 'cohost';
      }
    }
    
    // Check if purchased
    if (userId && !hasAccess) {
      const Purchase = require('../models/Purchase');
      const purchase = await Purchase.findOne({
        where: {
          userId,
          contentType: 'live_class',
          contentId: id,
          paymentStatus: 'completed'
        }
      });
      
      if (purchase) {
        hasAccess = true;
        accessReason = 'purchased';
        purchaseDate = purchase.createdAt;
      }
    }

    // Check if user has secured a free spot or paid
    let isRegistered = false;
    if (userId) {
      const price = parseFloat(live.price);
      if (price === 0) {
        const reg = await LiveAttendee.findOne({ where: { liveClassId: id, userId } });
        isRegistered = !!reg;
      } else {
        // Paid — registered if they have a completed purchase
        isRegistered = hasAccess && accessReason === 'purchased';
      }
    }

    // Build public response (always returned)
    const publicInfo = {
      id: live.id,
      title: live.title,
      description: live.description,
      price: live.price,
      currency: live.currency || 'NGN',
      category: live.category,
      thumbnailUrl: live.thumbnailUrl,
      startTime: live.startTime,
      endTime: live.endTime,
      status: live.status,
      privacy: live.privacy,
      streaming_provider: live.streaming_provider,
      max_participants: live.max_participants,
      createdAt: live.createdAt,
      updatedAt: live.updatedAt,
      // Instructor info
      instructor: live.creator ? {
        id: live.creator.id,
        name: `${live.creator.firstname} ${live.creator.lastname}`.trim(),
        firstname: live.creator.firstname,
        lastname: live.creator.lastname
      } : null,
      // Access flags
      hasAccess,
      requiresPayment: !hasAccess && price > 0,
      accessReason,
      isRegistered
    };

    // If user has access, add private streaming info
    if (hasAccess) {
      publicInfo.accessGranted = true;
      publicInfo.purchaseDate = purchaseDate;
      publicInfo.userId = live.userId;
      
      // Add streaming details only if user has access
      if (live.streaming_provider === 'zegocloud') {
        publicInfo.zego_room_id = live.zego_room_id;
        publicInfo.zego_app_id = live.zego_app_id;
        publicInfo.isZegoCloud = true;
        publicInfo.isMux = false;
      } else if (live.streaming_provider === 'mux') {
        publicInfo.mux_stream_id = live.mux_stream_id;
        publicInfo.mux_playback_id = live.mux_playback_id;
        publicInfo.mux_rtmp_url = live.mux_rtmp_url;
        publicInfo.recording_asset_id = live.recording_asset_id;
        publicInfo.isZegoCloud = false;
        publicInfo.isMux = true;
      }
    }

    return res.json({
      success: true,
      ...publicInfo,
      pricing: live.getDualPricing()
    });
  } catch (error) {
    console.error('[Live Controller] Get live class error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch live class details'
    });
  }
};

exports.getPlayback = async (req, res) => {
  try {
    const { id } = req.params;
    const live = await LiveClass.findByPk(id);
    
    if (!live) return res.status(404).json({ message: 'Live class not found.' });
    
    // Access control check (handled by middleware)
    if (!req.hasAccess) {
      return res.status(402).json({
        success: false,
        message: 'Payment required to access this live class',
        requiresPayment: true,
        price: live.price
      });
    }

    // ✅ ONLY check playback ID for Mux streams
    if (live.streaming_provider === 'mux') {
      if (!live.mux_playback_id) {
        return res.status(400).json({ message: 'Playback ID not generated yet.' });
      }
      const url = muxLiveService.generatePlaybackUrl(live.mux_playback_id);
      return res.json({ 
        playbackUrl: url,
        accessGranted: true,
        accessReason: req.accessReason
      });
    }

    // ✅ For ZegoCloud, redirect to join-room endpoint
    if (live.streaming_provider === 'zegocloud') {
      return res.status(400).json({
        success: false,
        message: 'ZegoCloud streams use real-time joining. Use /api/live/zegocloud/join-room instead.',
        redirectTo: `/api/live/zegocloud/join-room`,
        liveClassId: live.id
      });
    }

    return res.status(400).json({ message: 'Unknown streaming provider.' });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getHosts = async (req, res) => {
  try {
    const { id } = req.params;
    const hosts = await LiveHost.findAll({ where: { liveClassId: id }, include: [User] });
    return res.json({ hosts });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getAttendees = async (req, res) => {
  try {
    const { id } = req.params;
    const attendees = await LiveAttendee.findAll({ where: { liveClassId: id }, include: [User] });
    return res.json({ attendees });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Start ZegoCloud live session
 * POST /live/:id/start-zegocloud
 */
exports.startZegoCloudSession = async (req, res) => {
  try {
    const { id: liveClassId } = req.params;
    const userId = req.user.id;

    // Get live class details
    const liveClass = await LiveClass.findByPk(liveClassId);
    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found'
      });
    }

    // Only creator can start the session
    if (liveClass.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can start the live session'
      });
    }

    // Must be a ZegoCloud live class
    if (liveClass.streaming_provider !== 'zegocloud') {
      return res.status(400).json({
        success: false,
        message: 'This live class is not configured for ZegoCloud streaming'
      });
    }

    // Check if already live
    if (liveClass.status === 'live') {
      // ✅ Generate fresh token for creator instead of using stored one
      const { zegoCloudService } = require('../services/zegoCloudService');
      const freshToken = zegoCloudService.generateToken(liveClass.zego_room_id, userId, 'host');
      
      return res.status(409).json({
        success: false,
        message: 'Live class is already active',
        data: {
          roomId: liveClass.zego_room_id,
          appId: liveClass.zego_app_id,
          creatorToken: freshToken // ✅ Fresh token, not stored one
        }
      });
    }

    // Import ZegoCloud service
    const { zegoCloudService } = require('../services/zegoCloudService');

    // Start the live session
    const sessionResult = await zegoCloudService.startLiveSession(liveClassId, userId, {
      maxParticipants: liveClass.max_participants,
      privacy: liveClass.privacy
    });

    return res.status(200).json({
      success: true,
      message: 'ZegoCloud live session started successfully',
      data: {
        liveClassId: sessionResult.liveClassId,
        roomId: sessionResult.roomId,
        appId: sessionResult.appId,
        creatorToken: sessionResult.creatorToken,
        sessionStartedAt: sessionResult.sessionStartedAt,
        liveClass: {
          id: liveClass.id,
          title: liveClass.title,
          description: liveClass.description,
          privacy: liveClass.privacy,
          maxParticipants: liveClass.max_participants
        }
      }
    });

  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * End ZegoCloud live session
 * POST /live/:id/end-zegocloud
 */
exports.endZegoCloudSession = async (req, res) => {
  try {
    const { id: liveClassId } = req.params;
    const userId = req.user.id;

    // Get live class details
    const liveClass = await LiveClass.findByPk(liveClassId);
    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found'
      });
    }

    // Only creator can end the session
    if (liveClass.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can end the live session'
      });
    }

    // Must be a ZegoCloud live class
    if (liveClass.streaming_provider !== 'zegocloud') {
      return res.status(400).json({
        success: false,
        message: 'This live class is not configured for ZegoCloud streaming'
      });
    }

    // Import ZegoCloud service
    const { zegoCloudService } = require('../services/zegoCloudService');

    // End the live session
    const endResult = await zegoCloudService.endLiveSession(liveClassId, 'creator_ended');

    return res.status(200).json({
      success: true,
      message: 'ZegoCloud live session ended successfully',
      data: {
        liveClassId: endResult.liveClassId,
        endedAt: endResult.endedAt,
        reason: endResult.reason
      }
    });

  } catch (error) {
    return handleError(res, error);
  }
};

exports.getAllLiveClasses = async (req, res) => {
  try {
    const { status, privacy, category, showAll, limit = 20, offset = 0 } = req.query;
    
    const filters = {};
    
    // Filter by privacy if provided (default to public for unauthenticated users)
    if (privacy) {
      filters.privacy = privacy;
    } else {
      filters.privacy = 'public'; // Only show public classes by default
    }
    
    // 🎯 KEY CHANGE: Default to only show active classes for better UX
    if (status) {
      // If specific status requested, use it
      filters.status = status;
    } else if (!showAll || showAll !== 'true') {
      // Default: Only show scheduled and live classes (hide ended/recorded)
      // Use Sequelize Op.in for array filtering
      const { Op } = require('sequelize');
      filters.status = { [Op.in]: ['scheduled', 'live'] };
    }
    // If showAll=true is passed, show everything (for admin/creator views)
    
    // Filter by category if provided
    if (category) filters.category = category;

    const { count, rows: liveClasses } = await LiveClass.findAndCountAll({
      where: filters,
      order: [['startTime', 'ASC']],
      limit: Math.min(parseInt(limit), 100), // cap at 100
      offset: parseInt(offset),
      include: [
        {
          model: LiveHost,
          as: 'hosts',
          include: [{ model: User, attributes: ['id', 'firstname', 'lastname', 'email'] }]
        }
      ]
    });

    // Add dual pricing to each live class
    const liveClassesWithPricing = liveClasses.map(liveClass => {
      const classData = liveClass.toJSON();
      classData.pricing = liveClass.getDualPricing();
      return classData;
    });

    return res.json({
      count: liveClassesWithPricing.length,
      liveClasses: liveClassesWithPricing,
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Get user's own live classes
 * GET /live/my-classes
 */
exports.getMyLiveClasses = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, showAll, limit = 20, offset = 0 } = req.query;
    
    console.log(`[Live Controller] Getting live classes for user ${userId}`);
    
    const filters = { userId };
    
    // Filter by status if provided
    if (status) {
      filters.status = status;
    } else if (!showAll || showAll !== 'true') {
      // Default: Only show scheduled and live classes (hide ended)
      const { Op } = require('sequelize');
      filters.status = { [Op.in]: ['scheduled', 'live'] };
    }
    
    const { count, rows: liveClasses } = await LiveClass.findAndCountAll({
      where: filters,
      order: [['createdAt', 'DESC']], // Most recent first for user's own classes
      limit: Math.min(parseInt(limit), 100), // cap at 100
      offset: parseInt(offset),
      include: [
        {
          model: LiveHost,
          as: 'hosts',
          include: [{ model: User, attributes: ['id', 'firstname', 'lastname', 'email'] }]
        }
      ]
    });

    // Add dual pricing to each live class
    const liveClassesWithPricing = liveClasses.map(liveClass => {
      const classData = liveClass.toJSON();
      classData.pricing = liveClass.getDualPricing();
      return classData;
    });

    return res.json({ 
      success: true,
      count: liveClassesWithPricing.length,
      liveClasses: liveClassesWithPricing,
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(count / parseInt(limit))
      },
      filters: {
        userId,
        status,
        showAll
      }
    });
  } catch (error) {
    console.error('[Live Controller] Get my live classes error:', error);
    return handleError(res, error);
  }
};

/**
 * Delete live class
 * DELETE /live/:id
 */
exports.deleteLiveClass = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const liveClass = await LiveClass.findByPk(id);

    if (!liveClass) {
      return res.status(404).json({ success: false, message: 'Live class not found' });
    }

    // Ownership check
    if (liveClass.userId !== userId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own live classes' });
    }

    // Block deletion if currently live
    if (liveClass.status === 'live') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a live class that is currently streaming. Please end the session first.'
      });
    }

    // Check for completed purchases
    const Purchase = require('../models/Purchase');
    const purchaseCount = await Purchase.count({
      where: {
        contentType: 'live_class',
        contentId: id,
        paymentStatus: 'completed'
      }
    });

    if (purchaseCount > 0) {
      return res.status(403).json({
        success: false,
        message: 'This live class has been purchased by users and cannot be deleted. Please contact support.',
        hasPurchases: true
      });
    }

    // Delete thumbnail from S3
    if (liveClass.thumbnailUrl && liveClass.thumbnailUrl.startsWith('https://')) {
      try {
        const { deleteFileFromS3 } = require('../services/s3Service');
        await deleteFileFromS3(liveClass.thumbnailUrl);
        console.log(`[Live Controller] Deleted thumbnail from S3: ${liveClass.thumbnailUrl}`);
      } catch (s3Error) {
        console.error('[Live Controller] Failed to delete thumbnail from S3:', s3Error.message);
        // Non-fatal - continue with deletion
      }
    }

    // Delete Mux live stream and recording asset
    if (liveClass.streaming_provider === 'mux') {
      const mux = require('../config/mux');

      if (liveClass.mux_stream_id) {
        try {
          await mux.video.liveStreams.delete(liveClass.mux_stream_id);
          console.log(`[Live Controller] Deleted Mux live stream: ${liveClass.mux_stream_id}`);
        } catch (muxError) {
          console.error('[Live Controller] Failed to delete Mux live stream:', muxError.message);
        }
      }

      if (liveClass.recording_asset_id) {
        try {
          await mux.video.assets.delete(liveClass.recording_asset_id);
          console.log(`[Live Controller] Deleted Mux recording asset: ${liveClass.recording_asset_id}`);
        } catch (muxError) {
          console.error('[Live Controller] Failed to delete Mux recording asset:', muxError.message);
        }
      }
    }

    // Delete from DB (cascades to LiveHost and LiveAttendee)
    await liveClass.destroy();

    console.log(`[Live Controller] Live class ${id} deleted by user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Live class deleted successfully'
    });

  } catch (error) {
    return handleError(res, error);
  }
};

// ============================
//  LINK LIVE CLASS TO COMMUNITY
// ============================
exports.linkLiveClassToCommunity = async (req, res) => {
  try {
    const { id } = req.params;
    const { communityId, communityVisibility = 'community_only' } = req.body;
    const userId = req.user.id;

    if (!communityId) {
      return res.status(400).json({ success: false, message: 'communityId is required' });
    }

    const LiveClass = require('../models/liveClass');
    const liveClass = await LiveClass.findByPk(id);
    if (!liveClass) {
      return res.status(404).json({ success: false, message: 'Live class not found' });
    }

    if (liveClass.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const Community = require('../models/Community');
    const CommunityMember = require('../models/CommunityMember');
    const CommunityContentSubmission = require('../models/CommunityContentSubmission');

    const community = await Community.findByPk(communityId);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const membership = req.user.role === 'admin' ? null : await CommunityMember.findOne({
      where: { communityId, userId, status: 'active' }
    });

    const canDirectLink = req.user.role === 'admin' ||
      (membership && ['owner', 'moderator'].includes(membership.role));

    if (canDirectLink) {
      await liveClass.update({ communityId, communityVisibility });
      return res.json({ success: true, queued: false, data: liveClass });
    }

    if (!membership) {
      return res.status(403).json({ success: false, message: 'You must be an active member of this community.' });
    }

    const submission = await CommunityContentSubmission.create({
      communityId,
      submittedBy: userId,
      contentType: 'live_class',
      contentData: { ...liveClass.toJSON(), communityVisibility },
      status: 'pending'
    });

    return res.status(201).json({
      success: true,
      queued: true,
      message: 'Your live class has been submitted for moderator review.',
      data: submission
    });
  } catch (error) {
    console.error('[Live Controller] Link to community error:', error);
    return res.status(500).json({ success: false, message: 'Failed to link live class to community' });
  }
};

// ============================
//  SECURE A SPOT (free live classes only)
// ============================
exports.registerForLiveClass = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const liveClass = await LiveClass.findByPk(id);
    if (!liveClass) {
      return res.status(404).json({ success: false, message: 'Live class not found' });
    }

    if (liveClass.status !== 'scheduled') {
      return res.status(400).json({ success: false, message: 'This live class is no longer accepting registrations' });
    }

    const price = parseFloat(liveClass.price);
    if (price > 0) {
      return res.status(400).json({
        success: false,
        message: 'This is a paid live class. Please complete payment to register.'
      });
    }

    // Check if already registered
    const existing = await LiveAttendee.findOne({ where: { liveClassId: id, userId } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already secured a spot for this class.' });
    }

    // Check capacity
    if (liveClass.max_participants) {
      const count = await LiveAttendee.count({ where: { liveClassId: id } });
      if (count >= liveClass.max_participants) {
        return res.status(400).json({ success: false, message: 'Sorry, this class is full.' });
      }
    }

    const registration = await LiveAttendee.create({ liveClassId: id, userId, statusPaid: false });

    return res.status(201).json({
      success: true,
      message: 'Spot secured! You will receive a reminder before the class starts.',
      data: registration
    });
  } catch (error) {
    console.error('[Live Controller] Register error:', error);
    return res.status(500).json({ success: false, message: 'Failed to secure spot' });
  }
};

// ============================
//  CANCEL SPOT (free live classes)
// ============================
exports.cancelLiveClassRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const registration = await LiveAttendee.findOne({ where: { liveClassId: id, userId } });
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found' });
    }

    if (registration.statusPaid) {
      return res.status(400).json({ success: false, message: 'Paid registrations cannot be cancelled here. Contact support.' });
    }

    await registration.destroy();
    return res.json({ success: true, message: 'Registration cancelled.' });
  } catch (error) {
    console.error('[Live Controller] Cancel registration error:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel registration' });
  }
};

// ============================
//  GET REGISTRATIONS (creator/admin)
// ============================
exports.getLiveClassRegistrations = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const liveClass = await LiveClass.findByPk(id);
    if (!liveClass) {
      return res.status(404).json({ success: false, message: 'Live class not found' });
    }

    // Only creator or admin
    if (liveClass.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const Purchase = require('../models/Purchase');

    // Free registrations (LiveAttendee where statusPaid = false)
    const [freeRegs, paidPurchases, totalFree, totalPaid] = await Promise.all([
      LiveAttendee.findAll({
        where: { liveClassId: id, statusPaid: false },
        include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }],
        limit,
        offset,
        order: [['createdAt', 'DESC']]
      }),
      Purchase.findAll({
        where: { contentType: 'live_class', contentId: id, paymentStatus: 'completed' },
        include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }],
        order: [['createdAt', 'DESC']]
      }),
      LiveAttendee.count({ where: { liveClassId: id, statusPaid: false } }),
      Purchase.count({ where: { contentType: 'live_class', contentId: id, paymentStatus: 'completed' } })
    ]);

    const freeList = freeRegs.map(r => ({
      userId: r.userId,
      firstname: r.user?.firstname,
      lastname: r.user?.lastname,
      email: r.user?.email,
      registrationType: 'free',
      registeredAt: r.createdAt
    }));

    const paidList = paidPurchases.map(p => ({
      userId: p.userId,
      firstname: p.user?.firstname,
      lastname: p.user?.lastname,
      email: p.user?.email,
      registrationType: 'paid',
      amount: parseFloat(p.amount),
      currency: p.currency,
      registeredAt: p.createdAt
    }));

    return res.json({
      success: true,
      data: {
        total: totalFree + totalPaid,
        totalFree,
        totalPaid,
        page,
        limit,
        registrations: [...paidList, ...freeList]
      }
    });
  } catch (error) {
    console.error('[Live Controller] Get registrations error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch registrations' });
  }
};
