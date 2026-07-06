const LiveClass = require('../models/liveClass');
const { ZegoCloudError } = require('./zegoCloudService');

/**
 * ZegoCloud Status Synchronization Service
 * Handles database status updates and room lifecycle management
 */
class ZegoCloudStatusService {

  /**
   * Update live class status when streaming starts/stops
   * @param {string} liveClassId - Live class identifier
   * @param {string} status - New status: 'live', 'ended', 'scheduled'
   * @param {Object} additionalData - Additional data to update
   * @returns {Object} Update result
   */
  async updateLiveClassStatus(liveClassId, status, additionalData = {}) {
    try {
      if (!liveClassId) {
        throw new Error('Live class ID is required');
      }

      const validStatuses = ['scheduled', 'live', 'ended', 'recorded'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
      }

      // Find the live class
      const liveClass = await LiveClass.findByPk(liveClassId);
      if (!liveClass) {
        throw new Error('Live class not found');
      }

      // Prepare update data
      const updateData = {
        status,
        ...additionalData
      };

      // Add timestamps based on status
      if (status === 'live' && !liveClass.startTime) {
        updateData.startTime = new Date();
      } else if (status === 'ended' && !liveClass.endTime) {
        updateData.endTime = new Date();
      }

      // Update the live class
      await liveClass.update(updateData);

      console.log(`Live class ${liveClassId} status updated to: ${status}`);

      return {
        success: true,
        liveClassId,
        previousStatus: liveClass.status,
        newStatus: status,
        updatedAt: new Date(),
        updateData
      };

    } catch (error) {
      console.error('Update live class status error:', error);
      throw new ZegoCloudError(
        'Failed to update live class status',
        'STATUS_UPDATE_FAILED',
        { liveClassId, status, error: error.message }
      );
    }
  }

  /**
   * Start a live streaming session
   * @param {string} liveClassId - Live class identifier
   * @param {string} roomId - ZegoCloud room identifier
   * @param {string} appId - ZegoCloud app identifier
   * @param {string} creatorToken - Creator access token
   * @returns {Object} Start result
   */
  async startLiveSession(liveClassId, roomId, appId, creatorToken) {
    try {
      const updateData = {
        zego_room_id: roomId,
        zego_app_id: appId,
        streaming_provider: 'zegocloud',
        zego_room_token: creatorToken
      };

      const result = await this.updateLiveClassStatus(liveClassId, 'live', updateData);

      console.log(`Live session started for class ${liveClassId} with room ${roomId}`);

      return {
        ...result,
        roomId,
        appId,
        sessionStarted: true
      };

    } catch (error) {
      console.error('Start live session error:', error);
      throw new ZegoCloudError(
        'Failed to start live session',
        'SESSION_START_FAILED',
        { liveClassId, roomId, error: error.message }
      );
    }
  }

  /**
   * End a live streaming session
   * @param {string} liveClassId - Live class identifier
   * @param {string} reason - Reason for ending (optional)
   * @returns {Object} End result
   */
  async endLiveSession(liveClassId, reason = 'completed') {
    try {
      const result = await this.updateLiveClassStatus(liveClassId, 'ended');

      console.log(`Live session ended for class ${liveClassId}. Reason: ${reason}`);

      return {
        ...result,
        reason,
        sessionEnded: true
      };

    } catch (error) {
      console.error('End live session error:', error);
      throw new ZegoCloudError(
        'Failed to end live session',
        'SESSION_END_FAILED',
        { liveClassId, reason, error: error.message }
      );
    }
  }

  /**
   * Check for and prevent duplicate active sessions for a creator
   * @param {number} creatorId - Creator user ID
   * @param {string} excludeLiveClassId - Live class ID to exclude from check (optional)
   * @returns {Object} Duplicate check result
   */
  async checkDuplicateSessions(creatorId, excludeLiveClassId = null) {
    try {
      if (!creatorId || typeof creatorId !== 'number') {
        throw new Error('Creator ID is required and must be a number');
      }

      // Find active live classes for this creator
      const whereClause = {
        userId: creatorId,
        status: 'live'
      };

      // Exclude specific live class if provided
      if (excludeLiveClassId) {
        whereClause.id = { [require('sequelize').Op.ne]: excludeLiveClassId };
      }

      const activeLiveClasses = await LiveClass.findAll({
        where: whereClause,
        attributes: ['id', 'title', 'startTime', 'zego_room_id']
      });

      const hasDuplicates = activeLiveClasses.length > 0;

      if (hasDuplicates) {
        console.warn(`Creator ${creatorId} has ${activeLiveClasses.length} active live sessions`);
      }

      return {
        success: true,
        hasDuplicates,
        duplicateCount: activeLiveClasses.length,
        activeSessions: activeLiveClasses.map(lc => ({
          id: lc.id,
          title: lc.title,
          startTime: lc.startTime,
          roomId: lc.zego_room_id
        })),
        creatorId,
        checkedAt: new Date()
      };

    } catch (error) {
      console.error('Check duplicate sessions error:', error);
      throw new ZegoCloudError(
        'Failed to check for duplicate sessions',
        'DUPLICATE_CHECK_FAILED',
        { creatorId, error: error.message }
      );
    }
  }

  /**
   * Cleanup inactive rooms (rooms that should have ended but status wasn't updated)
   * @param {number} maxAgeHours - Maximum age in hours for active rooms
   * @returns {Object} Cleanup result
   */
  async cleanupInactiveRooms(maxAgeHours = 24) {
    try {
      const cutoffTime = new Date(Date.now() - (maxAgeHours * 60 * 60 * 1000));

      // Find live classes that have been 'live' for too long
      const staleRooms = await LiveClass.findAll({
        where: {
          status: 'live',
          streaming_provider: 'zegocloud',
          startTime: {
            [require('sequelize').Op.lt]: cutoffTime
          }
        },
        attributes: ['id', 'title', 'startTime', 'zego_room_id', 'userId']
      });

      const cleanupResults = [];

      for (const liveClass of staleRooms) {
        try {
          await this.endLiveSession(liveClass.id, 'auto_cleanup');
          cleanupResults.push({
            liveClassId: liveClass.id,
            title: liveClass.title,
            roomId: liveClass.zego_room_id,
            startTime: liveClass.startTime,
            cleaned: true
          });
        } catch (error) {
          console.error(`Failed to cleanup room ${liveClass.zego_room_id}:`, error);
          cleanupResults.push({
            liveClassId: liveClass.id,
            title: liveClass.title,
            roomId: liveClass.zego_room_id,
            cleaned: false,
            error: error.message
          });
        }
      }

      console.log(`Cleaned up ${cleanupResults.filter(r => r.cleaned).length} inactive rooms`);

      return {
        success: true,
        totalFound: staleRooms.length,
        totalCleaned: cleanupResults.filter(r => r.cleaned).length,
        cleanupResults,
        cutoffTime,
        cleanedAt: new Date()
      };

    } catch (error) {
      console.error('Cleanup inactive rooms error:', error);
      throw new ZegoCloudError(
        'Failed to cleanup inactive rooms',
        'CLEANUP_FAILED',
        { maxAgeHours, error: error.message }
      );
    }
  }

  /**
   * Get live class status and room information
   * @param {string} liveClassId - Live class identifier
   * @returns {Object} Status information
   */
  async getLiveClassStatus(liveClassId) {
    try {
      const liveClass = await LiveClass.findByPk(liveClassId);
      if (!liveClass) {
        throw new Error('Live class not found');
      }

      return {
        success: true,
        liveClassId,
        status: liveClass.status,
        streamingProvider: liveClass.streaming_provider,
        roomId: liveClass.zego_room_id,
        appId: liveClass.zego_app_id,
        startTime: liveClass.startTime,
        endTime: liveClass.endTime,
        maxParticipants: liveClass.max_participants,
        privacy: liveClass.privacy,
        retrievedAt: new Date()
      };

    } catch (error) {
      console.error('Get live class status error:', error);
      throw new ZegoCloudError(
        'Failed to get live class status',
        'STATUS_RETRIEVAL_FAILED',
        { liveClassId, error: error.message }
      );
    }
  }

  /**
   * Validate status transition
   * @param {string} currentStatus - Current status
   * @param {string} newStatus - Desired new status
   * @returns {Object} Validation result
   */
  validateStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      'scheduled': ['live', 'ended'],
      'live': ['ended', 'recorded'],
      'ended': ['recorded'],
      'recorded': [] // Final state
    };

    const isValid = validTransitions[currentStatus]?.includes(newStatus) || false;

    return {
      valid: isValid,
      currentStatus,
      newStatus,
      allowedTransitions: validTransitions[currentStatus] || [],
      message: isValid 
        ? `Valid transition from ${currentStatus} to ${newStatus}`
        : `Invalid transition from ${currentStatus} to ${newStatus}. Allowed: ${validTransitions[currentStatus]?.join(', ') || 'none'}`
    };
  }

  /**
   * Batch update multiple live class statuses
   * @param {Array} updates - Array of {liveClassId, status, additionalData} objects
   * @returns {Object} Batch update result
   */
  async batchUpdateStatuses(updates) {
    try {
      if (!Array.isArray(updates) || updates.length === 0) {
        throw new Error('Updates array is required and must not be empty');
      }

      const results = [];
      const errors = [];

      for (const update of updates) {
        try {
          const result = await this.updateLiveClassStatus(
            update.liveClassId,
            update.status,
            update.additionalData || {}
          );
          results.push(result);
        } catch (error) {
          errors.push({
            liveClassId: update.liveClassId,
            error: error.message
          });
        }
      }

      return {
        success: errors.length === 0,
        totalUpdates: updates.length,
        successfulUpdates: results.length,
        failedUpdates: errors.length,
        results,
        errors,
        processedAt: new Date()
      };

    } catch (error) {
      console.error('Batch update statuses error:', error);
      throw new ZegoCloudError(
        'Failed to batch update statuses',
        'BATCH_UPDATE_FAILED',
        { error: error.message }
      );
    }
  }
}

// Export singleton instance
const zegoCloudStatusService = new ZegoCloudStatusService();

module.exports = {
  zegoCloudStatusService,
  ZegoCloudStatusService
};