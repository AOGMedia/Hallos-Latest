const { uploadVideoService } = require('../services/videoService');
const Video = require('../models/Video');
const { recordView } = require('../services/videoAnalyticsService');
const jwt = require('jsonwebtoken');

/**
 * Helper function to extract user from token (optional authentication)
 */
const extractUserFromToken = (req) => {
  try {
    // Try header first
    let token = req.header('Authorization')?.replace('Bearer ', '');
    // If not in header, try cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    return decoded;
  } catch (error) {
    return null;
  }
};

exports.uploadVideo = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      currency,
      type,
      category,
      tags,
      privacy,
      ageRestriction,
      videoUrl, // for direct upload (URL from frontend)
    } = req.body;

    const userId = req.user.id; // from auth middleware
    // Check multiple possible field names (thumbnail, thumbnailUrl, image, file)
    const thumbnailFile = req.files?.thumbnail?.[0] || req.files?.thumbnailUrl?.[0] || req.files?.image?.[0] || req.files?.file?.[0];

    // 🔍 Debug logging
    console.log('📸 Video Upload - Thumbnail Debug:', {
      hasFiles: !!req.files,
      fileKeys: req.files ? Object.keys(req.files) : [],
      thumbnailFile: thumbnailFile ? {
        fieldname: thumbnailFile.fieldname,
        originalname: thumbnailFile.originalname,
        mimetype: thumbnailFile.mimetype,
        size: thumbnailFile.size,
        location: thumbnailFile.location, // S3 URL
        filename: thumbnailFile.filename  // Local filename
      } : null
    });

    const result = await uploadVideoService({
      userId,
      title,
      description,
      price,
      currency,
      type,
      category,
      tags: tags ? tags.split(',') : [],
      privacy,
      ageRestriction: ageRestriction === 'true',
      videoUrl,
      thumbnailFile,
    });

    res.status(201).json({
      success: true,
      message: 'Video upload initialized successfully',
      uploadUrl: result.uploadUrl,
      video: result.video,
    });
  } catch (err) {
    console.error('❌ Video upload error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getAllVideos = async (req, res) => {
  try {
    const { type, category, search } = req.query;

    const filters = {
      privacy: 'public',
      status: 'ready'
    };

    if (type) filters.type = type;
    if (category) filters.category = category;
    if (search)
      filters.title = { [Op.iLike]: `%${search}%` };

    const videos = await Video.findAll({
      where: filters,
      order: [['created_at', 'DESC']]
    });

    // Add dual pricing to each video
    const videosWithPricing = videos.map(video => {
      const videoData = video.toJSON();
      videoData.pricing = video.getDualPricing();
      return videoData;
    });

    return res.status(200).json({
      count: videosWithPricing.length,
      videos: videosWithPricing
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    return res.status(500).json({ message: 'Server error fetching videos.' });
  }
};

// ============================
//  GET SINGLE VIDEO BY ID
// ============================
exports.getVideoById = async (req, res) => {
  try {
    const { id } = req.params;

    const video = await Video.findOne({ where: { id } });

    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    // Privacy check (if you want private/unlisted logic)
    if (video.privacy === 'private') {
      const authUser = req.user;
      if (!authUser || authUser.id !== video.userId) {
        return res.status(403).json({ message: 'This video is private.' });
      }
    }

    // Access control check (handled by middleware)
    // If middleware passed, user has access
    if (!req.hasAccess) {
      // This shouldn't happen if middleware is properly configured
      return res.status(402).json({
        success: false,
        message: 'Payment required to access this video',
        requiresPayment: true,
        price: video.price
      });
    }

    // Build playback URL using muxPlaybackId (only if user has access)
    const playbackUrl = video.muxPlaybackId
      ? `https://stream.mux.com/${video.muxPlaybackId}.m3u8`
      : null;

    // Record analytics
    const user = req.user || extractUserFromToken(req);
    const userId = user ? user.id : null;
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    recordView({ videoId: id, userId, ipAddress });

    return res.status(200).json({
      ...video.dataValues,
      playbackUrl,
      accessGranted: true,
      accessReason: req.accessReason,
      purchaseDate: req.purchaseDate || null,
      pricing: video.getDualPricing()
    });
  } catch (error) {
    console.error('Error fetching video by ID:', error);
    return res.status(500).json({ message: 'Server error fetching video.' });
  }
};

// ============================
//  GET VIDEOS BY USER (Creator dashboard)
// ============================
exports.getUserVideos = async (req, res) => {
  try {
    const { userId } = req.params;
    const userIdInt = parseInt(userId, 10);

    // Ensure userId from params matches authenticated user
    if (req.user.id !== userIdInt) {
      return res.status(403).json({ message: 'Unauthorized access.' });
    }

    const videos = await Video.findAll({
      where: { userId: userIdInt },
      order: [['created_at', 'DESC']]
    });

    // Add dual pricing to each video
    const videosWithPricing = videos.map(video => {
      const videoData = video.toJSON();
      videoData.pricing = video.getDualPricing();
      return videoData;
    });

    return res.status(200).json({
      count: videosWithPricing.length,
      videos: videosWithPricing
    });
  } catch (error) {
    console.error('Error fetching user videos:', error);
    return res.status(500).json({ message: 'Server error fetching user videos.' });
  }
};

// ============================
//  GET CURRENT USER'S VIDEOS (Convenience endpoint)
// ============================
exports.getMyVideos = async (req, res) => {
  try {
    const userId = req.user.id;

    const videos = await Video.findAll({
      where: { userId },
      order: [['created_at', 'DESC']]
    });

    // Add dual pricing to each video
    const videosWithPricing = videos.map(video => {
      const videoData = video.toJSON();
      videoData.pricing = video.getDualPricing();
      return videoData;
    });

    return res.status(200).json({
      count: videosWithPricing.length,
      videos: videosWithPricing
    });
  } catch (error) {
    console.error('Error fetching my videos:', error);
    return res.status(500).json({ message: 'Server error fetching videos.' });
  }
};

// ============================
//  DELETE VIDEO
// ============================
exports.deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const video = await Video.findByPk(id);

    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    // Ownership check
    if (video.userId !== userId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own videos' });
    }

    // Check for completed purchases
    const Purchase = require('../models/Purchase');
    const purchaseCount = await Purchase.count({
      where: {
        contentType: 'video',
        contentId: id,
        paymentStatus: 'completed'
      }
    });

    if (purchaseCount > 0) {
      return res.status(403).json({
        success: false,
        message: 'This video has been purchased by users and cannot be deleted. Please contact support.',
        hasPurchases: true
      });
    }

    // Delete thumbnail from S3
    if (video.thumbnailUrl && video.thumbnailUrl.startsWith('https://')) {
      try {
        const { deleteFileFromS3 } = require('../services/s3Service');
        await deleteFileFromS3(video.thumbnailUrl);
        console.log(`[Video Controller] Deleted thumbnail from S3: ${video.thumbnailUrl}`);
      } catch (s3Error) {
        console.error('[Video Controller] Failed to delete thumbnail from S3:', s3Error.message);
        // Non-fatal - continue with deletion
      }
    }

    // Delete Mux asset
    if (video.muxAssetId) {
      try {
        const mux = require('../config/mux');
        await mux.video.assets.delete(video.muxAssetId);
        console.log(`[Video Controller] Deleted Mux asset: ${video.muxAssetId}`);
      } catch (muxError) {
        console.error('[Video Controller] Failed to delete Mux asset:', muxError.message);
        // Non-fatal - continue with deletion
      }
    }

    // Delete from DB
    await video.destroy();

    console.log(`[Video Controller] Video ${id} deleted by user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Video deleted successfully'
    });

  } catch (error) {
    console.error('[Video Controller] Delete video error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete video' });
  }
};

// ============================
//  LINK VIDEO TO COMMUNITY
// ============================
exports.linkVideoToCommunity = async (req, res) => {
  try {
    const { id } = req.params;
    const { communityId, communityVisibility = 'community_only' } = req.body;
    const userId = req.user.id;

    if (!communityId) {
      return res.status(400).json({ success: false, message: 'communityId is required' });
    }

    const video = await Video.findByPk(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    if (video.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const Community = require('../models/Community');
    const CommunityMember = require('../models/CommunityMember');
    const CommunityContentSubmission = require('../models/CommunityContentSubmission');

    const community = await Community.findByPk(communityId);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    // Check caller's role in the community
    const membership = req.user.role === 'admin' ? null : await CommunityMember.findOne({
      where: { communityId, userId, status: 'active' }
    });

    const canDirectLink = req.user.role === 'admin' ||
      (membership && ['owner', 'moderator'].includes(membership.role));

    if (canDirectLink) {
      await video.update({ communityId, communityVisibility });
      return res.json({ success: true, queued: false, data: video });
    }

    // Regular member — must go through submission queue
    if (!membership) {
      return res.status(403).json({ success: false, message: 'You must be an active member of this community.' });
    }

    const submission = await CommunityContentSubmission.create({
      communityId,
      submittedBy: userId,
      contentType: 'video',
      contentData: { ...video.toJSON(), communityVisibility },
      status: 'pending'
    });

    return res.status(201).json({
      success: true,
      queued: true,
      message: 'Your video has been submitted for moderator review.',
      data: submission
    });
  } catch (error) {
    console.error('[Video Controller] Link to community error:', error);
    return res.status(500).json({ success: false, message: 'Failed to link video to community' });
  }
};
