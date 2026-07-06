const { zegoCloudService, ZegoCloudError } = require('../services/zegoCloudService');
// Note: Error handling utilities available if needed
// const { createError, validateRequiredFields, validateUserPermissions, logOperation } = require('../utils/zegoCloudErrors');
const LiveClass = require('../models/liveClass');
const User = require('../models/User');
const crypto = require('crypto');

/**
 * ZegoCloud Controller
 * Handles all ZegoCloud live streaming API endpoints
 */

/**
 * Enforce privacy settings for live class access
 * @param {Object} liveClass - Live class instance
 * @param {number} userId - User ID requesting access
 * @param {string} invitationCode - Optional invitation code for private rooms
 * @param {boolean} hasAccess - Whether user has purchased access
 * @returns {Object} Access control result
 */
const enforcePrivacySettings = async (liveClass, userId, invitationCode, hasAccess) => {
  try {
    // Creator always has access
    if (liveClass.userId === userId) {
      return { allowed: true };
    }

    // Check if user is a co-host (co-hosts don't need to pay)
    const { LiveHost } = require('../models/liveIndex');
    const isHost = await LiveHost.findOne({
      where: {
        liveClassId: liveClass.id,
        userId: userId
      }
    });

    if (isHost) {
      return { allowed: true, reason: 'cohost' };
    }

    // Public rooms - check payment access
    if (liveClass.privacy === 'public') {
      if (liveClass.price > 0 && !hasAccess) {
        return {
          allowed: false,
          statusCode: 402,
          message: 'Payment required to access this live class',
          code: 'PAYMENT_REQUIRED'
        };
      }
      return { allowed: true };
    }

    // Private rooms - require invitation or payment + invitation
    if (liveClass.privacy === 'private') {
      // Check payment requirement first
      if (liveClass.price > 0 && !hasAccess) {
        return {
          allowed: false,
          statusCode: 402,
          message: 'Payment required to access this private live class',
          code: 'PAYMENT_REQUIRED'
        };
      }

      // Check invitation code
      if (!invitationCode) {
        return {
          allowed: false,
          statusCode: 403,
          message: 'Invitation code required for private live class',
          code: 'INVITATION_REQUIRED'
        };
      }

      // Validate invitation code
      const validInvitationCode = generateInvitationCode(liveClass.id, liveClass.userId);
      if (invitationCode !== validInvitationCode) {
        return {
          allowed: false,
          statusCode: 403,
          message: 'Invalid invitation code',
          code: 'INVALID_INVITATION'
        };
      }

      return { allowed: true };
    }

    // Unknown privacy setting
    return {
      allowed: false,
      statusCode: 400,
      message: 'Invalid privacy setting',
      code: 'INVALID_PRIVACY_SETTING'
    };

  } catch (error) {
    console.error('Privacy enforcement error:', error);
    return {
      allowed: false,
      statusCode: 500,
      message: 'Failed to check access permissions',
      code: 'ACCESS_CHECK_FAILED'
    };
  }
};

/**
 * Generate invitation code for private live classes
 * @param {string} liveClassId - Live class ID
 * @param {number} creatorId - Creator user ID
 * @returns {string} Invitation code
 */
const generateInvitationCode = (liveClassId, creatorId) => {
  const data = `${liveClassId}-${creatorId}-${process.env.JWT_SECRET || 'default-secret'}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 12).toUpperCase();
};

/**
 * Get invitation code for private live class
 * GET /api/live/zegocloud/invitation/:id
 */
const getInvitationCode = async (req, res) => {
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

    // Only creator can get invitation code
    if (liveClass.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can generate invitation codes'
      });
    }

    // Only for private live classes
    if (liveClass.privacy !== 'private') {
      return res.status(400).json({
        success: false,
        message: 'Invitation codes are only available for private live classes'
      });
    }

    const invitationCode = generateInvitationCode(liveClass.id, liveClass.userId);

    res.status(200).json({
      success: true,
      data: {
        liveClassId: liveClass.id,
        invitationCode,
        privacy: liveClass.privacy,
        expiresAt: null, // Invitation codes don't expire in this implementation
        shareUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/live/${liveClass.id}?invitation=${invitationCode}`
      }
    });

  } catch (error) {
    console.error('Get invitation code error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to generate invitation code'
    });
  }
};

/**
 * Validate invitation code
 * POST /api/live/zegocloud/validate-invitation
 */
const validateInvitation = async (req, res) => {
  try {
    const { liveClassId, invitationCode } = req.body;

    // Validate required fields
    if (!liveClassId || !invitationCode) {
      return res.status(400).json({
        success: false,
        message: 'Live class ID and invitation code are required'
      });
    }

    // Get live class details
    const liveClass = await LiveClass.findByPk(liveClassId);
    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found'
      });
    }

    // Check if it's a private live class
    if (liveClass.privacy !== 'private') {
      return res.status(400).json({
        success: false,
        message: 'Invitation validation is only for private live classes'
      });
    }

    // Validate invitation code
    const validInvitationCode = generateInvitationCode(liveClass.id, liveClass.userId);
    const isValid = invitationCode === validInvitationCode;

    res.status(200).json({
      success: true,
      data: {
        liveClassId: liveClass.id,
        isValid,
        liveClass: isValid ? {
          id: liveClass.id,
          title: liveClass.title,
          description: liveClass.description,
          price: liveClass.price,
          thumbnailUrl: liveClass.thumbnailUrl,
          startTime: liveClass.startTime,
          privacy: liveClass.privacy,
          status: liveClass.status
        } : null
      }
    });

  } catch (error) {
    console.error('Validate invitation error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to validate invitation code'
    });
  }
};

/**
 * Create a new ZegoCloud room for live streaming
 * POST /api/live/zegocloud/create-room
 */
const createRoom = async (req, res) => {
  try {
    const { liveClassId, maxParticipants, privacy } = req.body;
    const creatorId = req.user.id;

    // Validate required fields
    if (!liveClassId) {
      return res.status(400).json({
        success: false,
        message: 'Live class ID is required'
      });
    }

    // Verify live class exists and belongs to creator
    const liveClass = await LiveClass.findOne({
      where: { 
        id: liveClassId,
        userId: creatorId 
      }
    });

    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found or access denied'
      });
    }

    // Check if room already exists for this live class
    if (liveClass.zego_room_id && liveClass.status === 'live') {
      return res.status(409).json({
        success: false,
        message: 'Live class already has an active room',
        roomId: liveClass.zego_room_id
      });
    }

    // Create ZegoCloud room
    const roomResult = await zegoCloudService.createRoom(liveClassId, creatorId, {
      maxParticipants,
      privacy: privacy || liveClass.privacy
    });

    // Update live class with ZegoCloud room details
    await liveClass.update({
      zego_room_id: roomResult.roomId,
      zego_app_id: roomResult.appId,
      streaming_provider: 'zegocloud',
      // ❌ REMOVED: zego_room_token: roomResult.creatorToken,
      max_participants: maxParticipants || null,
      status: 'live'
    });

    res.status(201).json({
      success: true,
      message: 'ZegoCloud room created successfully',
      data: {
        roomId: roomResult.roomId,
        appId: roomResult.appId,
        creatorToken: roomResult.creatorToken,
        liveClassId,
        maxParticipants: maxParticipants || null,
        privacy: privacy || liveClass.privacy
      }
    });

  } catch (error) {
    console.error('Create room error:', error);
    
    if (error instanceof ZegoCloudError) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create live streaming room'
    });
  }
};

/**
 * Join a ZegoCloud room with official token generation
 * POST /api/live/zegocloud/join-room
 */
const joinRoom = async (req, res) => {
  try {
    const { liveClassId, role = 'participant', invitationCode } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!liveClassId) {
      return res.status(400).json({
        success: false,
        message: 'Live class ID is required'
      });
    }

    // Get live class details
    const liveClass = await LiveClass.findByPk(liveClassId);
    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found'
      });
    }

    // Check if live class is active
    if (liveClass.status !== 'live' || !liveClass.zego_room_id) {
      return res.status(400).json({
        success: false,
        message: 'Live class is not currently active'
      });
    }

    // Normalize role (frontend might send 'Cohost', 'cohost', 'CoHost', etc.)
    const normalizedRole = role.toLowerCase();
    const isCohost = normalizedRole === 'cohost';
    const isCreator = liveClass.userId === userId;

    // Co-hosts and creators bypass payment check
    if (!isCohost && !isCreator) {
      // Regular participants need to pass privacy and payment checks
      const accessCheck = await enforcePrivacySettings(liveClass, userId, invitationCode, req.hasAccess);
      if (!accessCheck.allowed) {
        return res.status(accessCheck.statusCode).json({
          success: false,
          message: accessCheck.message,
          code: accessCheck.code
        });
      }
    }

    // Get user information for display
    const user = await User.findByPk(userId);
    const userInfo = {
      displayName: user ? user.firstname : `User ${userId}`,
      avatar: user ? user.avatar : null,
      email: user ? user.email : null
    };

    // Determine ZegoCloud role
    // Creator and co-hosts get 'host', others get 'participant' or 'audience'
    let participantRole = 'participant';
    let userType = 'participant';
    
    if (isCreator) {
      participantRole = 'host';
      userType = 'creator';
    } else if (isCohost) {
      participantRole = 'host'; // Co-hosts get host privileges
      userType = 'cohost';
    } else {
      // Regular participants - validate role
      const validRoles = ['participant', 'audience'];
      participantRole = validRoles.includes(normalizedRole) ? normalizedRole : 'participant';
      userType = 'participant';
    }

    // ✅ Generate official ZegoCloud token
    const token = zegoCloudService.generateToken(
      liveClass.zego_room_id,
      userId,
      participantRole
    );

    console.log(`[ZegoCloud Controller] User ${userId} joined as ${userType} with role ${participantRole}`);

    // Return response with official token
    res.status(200).json({
      success: true,
      message: 'Successfully joined live class',
      data: {
        roomId: liveClass.zego_room_id,
        appId: liveClass.zego_app_id,
        token: token, // ✅ Official ZegoCloud token
        role: participantRole,
        userType: userType, // 'creator', 'cohost', or 'participant'
        isCohost: isCohost,
        userInfo: userInfo,
        liveClass: {
          id: liveClass.id,
          title: liveClass.title,
          description: liveClass.description,
          privacy: liveClass.privacy
        }
      }
    });

  } catch (error) {
    console.error('Join room error:', error);
    
    if (error instanceof ZegoCloudError) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to join live class'
    });
  }
};

/**
 * Get room information
 * GET /api/live/zegocloud/room/:id
 */
const getRoomInfo = async (req, res) => {
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

    // Check if user has access (creator or purchased access)
    const hasAccess = liveClass.userId === userId || req.hasAccess;

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Purchase required to view live class details.'
      });
    }

    // Get room info from ZegoCloud service
    let roomInfo = null;
    if (liveClass.zego_room_id) {
      try {
        roomInfo = await zegoCloudService.getRoomInfo(liveClass.zego_room_id);
      } catch (error) {
        console.warn('Failed to get room info from ZegoCloud:', error.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        liveClass: {
          id: liveClass.id,
          title: liveClass.title,
          description: liveClass.description,
          price: liveClass.price,
          thumbnailUrl: liveClass.thumbnailUrl,
          startTime: liveClass.startTime,
          endTime: liveClass.endTime,
          privacy: liveClass.privacy,
          status: liveClass.status,
          streamingProvider: liveClass.streaming_provider,
          maxParticipants: liveClass.max_participants
        },
        room: {
          roomId: liveClass.zego_room_id,
          appId: liveClass.zego_app_id,
          isActive: liveClass.status === 'live',
          info: roomInfo
        },
        userRole: liveClass.userId === userId ? 'creator' : 'participant'
      }
    });

  } catch (error) {
    console.error('Get room info error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get room information'
    });
  }
};

/**
 * End/delete a ZegoCloud room
 * DELETE /api/live/zegocloud/room/:id
 */
const endRoom = async (req, res) => {
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

    // Only creator can end the room
    if (liveClass.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can end the live class'
      });
    }

    // Check if room exists
    if (!liveClass.zego_room_id) {
      return res.status(400).json({
        success: false,
        message: 'No active room found for this live class'
      });
    }

    // Delete room from ZegoCloud
    await zegoCloudService.deleteRoom(liveClass.zego_room_id);

    // Update live class status
    await liveClass.update({
      status: 'ended',
      endTime: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Live class ended successfully',
      data: {
        liveClassId: liveClass.id,
        endedAt: liveClass.endTime
      }
    });

  } catch (error) {
    console.error('End room error:', error);
    
    if (error instanceof ZegoCloudError) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to end live class'
    });
  }
};

/**
 * Get participants in a room
 * GET /api/live/zegocloud/participants/:id
 */
const getParticipants = async (req, res) => {
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

    // Check if user has access
    const hasAccess = liveClass.userId === userId || req.hasAccess;
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if room exists
    if (!liveClass.zego_room_id) {
      return res.status(400).json({
        success: false,
        message: 'No active room found for this live class'
      });
    }

    // Get participants from ZegoCloud service
    const participantsResult = await zegoCloudService.getParticipants(liveClass.zego_room_id);

    res.status(200).json({
      success: true,
      data: {
        roomId: liveClass.zego_room_id,
        liveClassId: liveClass.id,
        participants: participantsResult.participants,
        participantCount: participantsResult.participantCount,
        maxParticipants: liveClass.max_participants
      }
    });

  } catch (error) {
    console.error('Get participants error:', error);
    
    if (error instanceof ZegoCloudError) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to get participants'
    });
  }
};

/**
 * Remove a participant from room
 * POST /api/live/zegocloud/remove-participant
 */
const removeParticipant = async (req, res) => {
  try {
    const { liveClassId, participantId, reason = 'removed' } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!liveClassId || !participantId) {
      return res.status(400).json({
        success: false,
        message: 'Live class ID and participant ID are required'
      });
    }

    // Get live class details
    const liveClass = await LiveClass.findByPk(liveClassId);
    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found'
      });
    }

    // Only creator can remove participants
    if (liveClass.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can remove participants'
      });
    }

    // Check if room exists
    if (!liveClass.zego_room_id) {
      return res.status(400).json({
        success: false,
        message: 'No active room found for this live class'
      });
    }

    // Remove participant from room
    const removeResult = await zegoCloudService.removeParticipant(
      liveClass.zego_room_id,
      participantId,
      reason
    );

    res.status(200).json({
      success: true,
      message: 'Participant removed successfully',
      data: {
        roomId: liveClass.zego_room_id,
        participantId,
        reason: removeResult.reason,
        removedAt: removeResult.removedAt
      }
    });

  } catch (error) {
    console.error('Remove participant error:', error);
    
    if (error instanceof ZegoCloudError) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to remove participant'
    });
  }
};

module.exports = {
  createRoom,
  joinRoom,
  getRoomInfo,
  endRoom,
  getParticipants,
  removeParticipant,
  getInvitationCode,
  validateInvitation,
  enforcePrivacySettings,
  generateInvitationCode
};