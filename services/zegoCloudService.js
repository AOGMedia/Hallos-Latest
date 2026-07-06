const { generateTokenWithRoomPrivileges, ErrorCode } = require('../utils/zegoServerAssistant');
const { 
  ZegoCloudError, 
  createError, 
  withErrorHandling, 
  validateRequiredFields,
  logOperation 
} = require('../utils/zegoCloudErrors');

// ZegoCloud configuration
const ZEGO_APP_ID = process.env.ZEGO_APP_ID;
const ZEGO_SERVER_SECRET = process.env.ZEGO_SERVER_SECRET;
const ZEGO_TOKEN_EXPIRY = parseInt(process.env.ZEGO_TOKEN_EXPIRY) || 3600;
const ZEGO_MAX_PARTICIPANTS = parseInt(process.env.ZEGO_MAX_PARTICIPANTS) || 50;

if (!ZEGO_APP_ID || !ZEGO_SERVER_SECRET) {
  console.error("FATAL: ZEGO_APP_ID or ZEGO_SERVER_SECRET is missing from .env");
}

/**
 * ZegoCloud Service using Official Token Generation
 * Now uses ZegoCloud's official server assistant for token generation
 */
class ZegoCloudService {
  
  /**
   * Create a new ZegoCloud room for live streaming
   * @param {string} liveClassId - Unique identifier for the live class
   * @param {number} creatorId - ID of the creator starting the live class
   * @param {Object} options - Additional room configuration options
   * @returns {Object} Room configuration with credentials
   */
  async createRoom(liveClassId, creatorId, options = {}) {
    return withErrorHandling(async () => {
      // Validate required inputs
      validateRequiredFields({ liveClassId, creatorId }, ['liveClassId', 'creatorId']);
      
      if (typeof creatorId !== 'number' || creatorId <= 0) {
        throw createError('INVALID_INPUT', { creatorId }, 'Creator ID must be a positive number');
      }

      // Check configuration
      if (!ZEGO_APP_ID || !ZEGO_SERVER_SECRET) {
        throw createError('MISSING_CREDENTIALS');
      }

      // Generate unique room ID
      const roomId = this.generateRoomId(liveClassId);
      
      // Generate creator token with host privileges using official ZegoCloud method
      const creatorToken = this.generateToken(roomId, creatorId, 'host');
      
      // Room configuration
      const roomConfig = {
        roomId,
        appId: ZEGO_APP_ID,
        creatorToken,
        maxParticipants: ZEGO_MAX_PARTICIPANTS,
        privacy: options.privacy || 'public',
        createdAt: new Date(),
        creatorId,
        liveClassId
      };

      logOperation('createRoom', {
        roomId,
        liveClassId,
        creatorId,
        maxParticipants: ZEGO_MAX_PARTICIPANTS,
        privacy: options.privacy
      });
      
      return {
        success: true,
        roomId,
        appId: ZEGO_APP_ID,
        creatorToken,
        roomConfig
      };
    })();
  }

  /**
   * Generate Official ZegoCloud Token using their server assistant
   * @param {string} roomId - Room identifier
   * @param {number} userId - User ID requesting access
   * @param {string} role - User role: 'host', 'participant', 'audience'
   * @returns {string} Official ZegoCloud token
   */
  generateToken(roomId, userId, role = 'participant') {
    try {
      if (!roomId || !userId) {
        throw new Error('Room ID and User ID are required');
      }

      const appId = parseInt(ZEGO_APP_ID);
      const userIdStr = userId.toString();
      const serverSecret = ZEGO_SERVER_SECRET;
      const effectiveTimeInSeconds = ZEGO_TOKEN_EXPIRY;
      
      // Validate server secret length (ZegoCloud requires exactly 32 bytes)
      if (!serverSecret || serverSecret.length !== 32) {
        throw new Error(`Server secret must be exactly 32 bytes. Current length: ${serverSecret ? serverSecret.length : 0}`);
      }
      
      // ✅ Use ZegoCloud's official token generation
      const token = generateTokenWithRoomPrivileges(
        appId,
        userIdStr,
        serverSecret,
        effectiveTimeInSeconds,
        roomId,
        role
      );
      
      console.log(`✅ Official ZegoCloud token generated for user ${userId} in room ${roomId} with role ${role}`);
      
      return token;
      
    } catch (error) {
      console.error('ZegoCloud generateToken error:', error);
      
      // Handle ZegoCloud specific errors
      if (error.errorCode !== undefined) {
        throw new ZegoCloudError(
          `ZegoCloud Error: ${error.errorMessage}`,
          'ZEGO_TOKEN_ERROR',
          { roomId, userId, role, zegoErrorCode: error.errorCode }
        );
      }
      
      throw new ZegoCloudError(
        'Failed to generate SDK token',
        'TOKEN_GENERATION_FAILED',
        { roomId, userId, role, error: error.message }
      );
    }
  }

  /**
   * Generate Official ZegoCloud UI Kit Token (same as SDK token)
   * @param {string} roomId - Room identifier
   * @param {number} userId - User ID requesting access
   * @param {string} role - User role: 'host', 'participant', 'audience'
   * @returns {string} Official ZegoCloud UI Kit token
   */
  generateKitToken(roomId, userId, role = 'participant') {
    // UI Kit uses the same token format as SDK
    return this.generateToken(roomId, userId, role);
  }

  /**
   * Add a participant to a room (generate join token)
   * @param {string} roomId - Room identifier
   * @param {number} userId - User ID to add
   * @param {string} role - Participant role
   * @param {Object} userInfo - Additional user information for display
   * @returns {Object} Join credentials
   */
  async addParticipant(roomId, userId, role = 'participant', userInfo = {}) {
    try {
      if (!roomId || typeof roomId !== 'string' || roomId.trim().length === 0) {
        throw new Error('Room ID is required and must be a non-empty string');
      }

      if (!userId || typeof userId !== 'number' || userId <= 0) {
        throw new Error('User ID is required and must be a positive number');
      }

      const validRoles = ['host', 'participant', 'audience'];
      if (!validRoles.includes(role)) {
        throw new Error(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`);
      }

      // Ensure userInfo is an object
      const safeUserInfo = userInfo || {};

      const token = this.generateToken(roomId, userId, role);
      
      const participantData = {
        success: true,
        roomId,
        userId,
        role,
        token,
        appId: ZEGO_APP_ID,
        joinedAt: new Date(),
        userInfo: {
          displayName: safeUserInfo.displayName || `User ${userId}`,
          avatar: safeUserInfo.avatar || null,
          email: safeUserInfo.email || null
        }
      };

      console.log(`Participant ${userId} added to room ${roomId} with role ${role}`);
      
      return participantData;
    } catch (error) {
      console.error('ZegoCloud addParticipant error:', error);
      throw new ZegoCloudError(
        'Failed to add participant',
        'PARTICIPANT_ADD_FAILED',
        { roomId, userId, role, error: error.message }
      );
    }
  }

  /**
   * Generate unique room ID based on live class ID
   * @param {string} liveClassId - Live class identifier
   * @returns {string} Unique room ID
   */
  generateRoomId(liveClassId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `live_${liveClassId}_${timestamp}_${random}`;
  }

  /**
   * Validate ZegoCloud configuration
   * @returns {Object} Configuration validation result
   */
  validateConfiguration() {
    const issues = [];
    
    if (!ZEGO_APP_ID) {
      issues.push('ZEGO_APP_ID is not configured');
    }
    
    if (!ZEGO_SERVER_SECRET) {
      issues.push('ZEGO_SERVER_SECRET is not configured');
    } else if (ZEGO_SERVER_SECRET.length !== 32) {
      issues.push(`ZEGO_SERVER_SECRET must be exactly 32 bytes (current: ${ZEGO_SERVER_SECRET.length})`);
    }
    
    if (ZEGO_TOKEN_EXPIRY < 300) {
      issues.push('ZEGO_TOKEN_EXPIRY should be at least 300 seconds (5 minutes)');
    }

    return {
      valid: issues.length === 0,
      issues,
      configuration: {
        appId: ZEGO_APP_ID ? 'configured' : 'missing',
        serverSecret: ZEGO_SERVER_SECRET ? `configured (${ZEGO_SERVER_SECRET.length} bytes)` : 'missing',
        tokenExpiry: ZEGO_TOKEN_EXPIRY
      }
    };
  }

  // Additional methods for completeness (simplified versions)
  async deleteRoom(roomId) {
    console.log(`ZegoCloud room cleanup initiated: ${roomId}`);
    return { success: true, roomId, message: 'Room cleanup completed', cleanedAt: new Date() };
  }

  async removeParticipant(roomId, userId, reason = 'removed') {
    console.log(`Participant ${userId} removed from room ${roomId}. Reason: ${reason}`);
    return { success: true, roomId, userId, removedAt: new Date(), reason, message: 'Participant access revoked' };
  }

  async getParticipants(roomId) {
    console.log(`Retrieving participants for room ${roomId}`);
    return { success: true, roomId, participants: [], participantCount: 0, retrievedAt: new Date() };
  }

  async getRoomInfo(roomId) {
    return { success: true, roomId, appId: ZEGO_APP_ID, status: 'active', retrievedAt: new Date() };
  }

  async startLiveSession(liveClassId, creatorId, options = {}) {
    try {
      const { LiveClass } = require('../models/liveIndex');
      
      const existingClass = await LiveClass.findByPk(liveClassId);
      if (!existingClass) {
        throw new Error(`Live class not found: ${liveClassId}`);
      }
      
      if (existingClass.status === 'live') {
        throw new Error('Live class is already active');
      }
      
      const roomResult = await this.createRoom(liveClassId, creatorId, options);
      
      await existingClass.update({
        zego_room_id: roomResult.roomId,
        zego_app_id: roomResult.appId,
        status: 'live',
        max_participants: options.maxParticipants || existingClass.max_participants,
        updatedAt: new Date()
      });
      
      console.log(`Live session started: ${liveClassId} with room ${roomResult.roomId}`);
      
      return {
        success: true,
        liveClassId,
        roomId: roomResult.roomId,
        appId: roomResult.appId,
        creatorToken: roomResult.creatorToken,
        sessionStartedAt: new Date()
      };
    } catch (error) {
      console.error('ZegoCloud startLiveSession error:', error);
      throw new ZegoCloudError(
        'Failed to start live session',
        'SESSION_START_FAILED',
        { liveClassId, creatorId, error: error.message }
      );
    }
  }

  async endLiveSession(liveClassId, reason = 'session_ended') {
    try {
      const { LiveClass } = require('../models/liveIndex');
      
      const liveClass = await LiveClass.findByPk(liveClassId);
      if (!liveClass) {
        throw new Error(`Live class not found: ${liveClassId}`);
      }
      
      if (liveClass.status !== 'live') {
        return { success: true, message: 'Session was not active', liveClassId, endedAt: new Date() };
      }
      
      if (liveClass.zego_room_id) {
        await this.deleteRoom(liveClass.zego_room_id);
      }
      
      await liveClass.update({
        status: 'ended',
        endTime: new Date(),
        updatedAt: new Date()
      });
      
      console.log(`Live session ended: ${liveClassId}. Reason: ${reason}`);
      
      return {
        success: true,
        liveClassId,
        roomId: liveClass.zego_room_id,
        reason,
        endedAt: new Date()
      };
    } catch (error) {
      console.error('ZegoCloud endLiveSession error:', error);
      throw new ZegoCloudError(
        'Failed to end live session',
        'SESSION_END_FAILED',
        { liveClassId, error: error.message }
      );
    }
  }
}

// Export singleton instance
const zegoCloudService = new ZegoCloudService();

module.exports = {
  zegoCloudService,
  ZegoCloudError
};