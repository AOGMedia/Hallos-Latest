const LiveClass = require('../models/liveClass');
const User = require('../models/User');
const { ZegoCloudError } = require('./zegoCloudService');

/**
 * ZegoCloud Privacy and Access Control Service
 * Handles privacy settings enforcement and access control for ZegoCloud rooms
 */
class ZegoCloudPrivacyService {

  /**
   * Check if a user has access to a private live class
   * @param {string} liveClassId - Live class identifier
   * @param {number} userId - User ID requesting access
   * @param {Object} options - Additional options for access check
   * @returns {Object} Access check result
   */
  async checkPrivateAccess(liveClassId, userId, options = {}) {
    try {
      if (!liveClassId || !userId) {
        throw new Error('Live class ID and user ID are required');
      }

      // Get live class details
      const liveClass = await LiveClass.findByPk(liveClassId);
      if (!liveClass) {
        throw new Error('Live class not found');
      }

      // Public classes are always accessible
      if (liveClass.privacy === 'public') {
        return {
          success: true,
          hasAccess: true,
          accessType: 'public',
          liveClassId,
          userId,
          privacy: 'public',
          reason: 'Public live class - access granted'
        };
      }

      // Creator always has access
      if (liveClass.userId === userId) {
        return {
          success: true,
          hasAccess: true,
          accessType: 'creator',
          liveClassId,
          userId,
          privacy: 'private',
          reason: 'Creator access - access granted'
        };
      }

      // For private classes, check if user has purchased access
      // This would typically integrate with the purchase system
      const hasPurchasedAccess = options.hasPurchasedAccess || false;

      if (hasPurchasedAccess) {
        return {
          success: true,
          hasAccess: true,
          accessType: 'purchased',
          liveClassId,
          userId,
          privacy: 'private',
          reason: 'Purchased access - access granted'
        };
      }

      // Check for invitation-based access (placeholder for future implementation)
      const hasInvitation = options.hasInvitation || false;

      if (hasInvitation) {
        return {
          success: true,
          hasAccess: true,
          accessType: 'invited',
          liveClassId,
          userId,
          privacy: 'private',
          reason: 'Invitation access - access granted'
        };
      }

      // Access denied for private class without purchase or invitation
      return {
        success: true,
        hasAccess: false,
        accessType: 'denied',
        liveClassId,
        userId,
        privacy: 'private',
        reason: 'Private live class - purchase required for access'
      };

    } catch (error) {
      console.error('Check private access error:', error);
      throw new ZegoCloudError(
        'Failed to check private access',
        'PRIVATE_ACCESS_CHECK_FAILED',
        { liveClassId, userId, error: error.message }
      );
    }
  }

  /**
   * Enforce privacy settings for room join requests
   * @param {string} liveClassId - Live class identifier
   * @param {number} userId - User ID requesting to join
   * @param {Object} accessContext - Context information for access control
   * @returns {Object} Privacy enforcement result
   */
  async enforcePrivacySettings(liveClassId, userId, accessContext = {}) {
    try {
      // Check access permissions
      const accessCheck = await this.checkPrivateAccess(liveClassId, userId, accessContext);

      if (!accessCheck.hasAccess) {
        return {
          success: false,
          allowed: false,
          liveClassId,
          userId,
          privacy: accessCheck.privacy,
          accessType: accessCheck.accessType,
          reason: accessCheck.reason,
          errorCode: 'ACCESS_DENIED',
          httpStatus: 403
        };
      }

      // Access granted
      return {
        success: true,
        allowed: true,
        liveClassId,
        userId,
        privacy: accessCheck.privacy,
        accessType: accessCheck.accessType,
        reason: accessCheck.reason,
        grantedAt: new Date()
      };

    } catch (error) {
      console.error('Enforce privacy settings error:', error);
      throw new ZegoCloudError(
        'Failed to enforce privacy settings',
        'PRIVACY_ENFORCEMENT_FAILED',
        { liveClassId, userId, error: error.message }
      );
    }
  }

  /**
   * Create an invitation for a private live class
   * @param {string} liveClassId - Live class identifier
   * @param {number} creatorId - Creator user ID
   * @param {number} inviteeId - User ID to invite
   * @param {Object} invitationOptions - Invitation configuration
   * @returns {Object} Invitation result
   */
  async createInvitation(liveClassId, creatorId, inviteeId, invitationOptions = {}) {
    try {
      if (!liveClassId || !creatorId || !inviteeId) {
        throw new Error('Live class ID, creator ID, and invitee ID are required');
      }

      // Verify live class exists and belongs to creator
      const liveClass = await LiveClass.findByPk(liveClassId);
      if (!liveClass) {
        throw new Error('Live class not found');
      }

      if (liveClass.userId !== creatorId) {
        throw new Error('Only the creator can send invitations');
      }

      if (liveClass.privacy !== 'private') {
        throw new Error('Invitations are only available for private live classes');
      }

      // Verify invitee exists
      const invitee = await User.findByPk(inviteeId);
      if (!invitee) {
        throw new Error('Invitee user not found');
      }

      // Generate invitation token (simplified implementation)
      const invitationToken = this.generateInvitationToken(liveClassId, inviteeId);

      // In a real implementation, this would be stored in a database
      const invitation = {
        id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        liveClassId,
        creatorId,
        inviteeId,
        token: invitationToken,
        status: 'pending',
        expiresAt: new Date(Date.now() + (invitationOptions.expiryHours || 24) * 60 * 60 * 1000),
        createdAt: new Date(),
        inviteeEmail: invitee.email,
        inviteeName: `${invitee.firstname} ${invitee.lastname}`,
        liveClassTitle: liveClass.title
      };

      console.log(`Invitation created for live class ${liveClassId}: ${inviteeId}`);

      return {
        success: true,
        invitation,
        message: 'Invitation created successfully'
      };

    } catch (error) {
      console.error('Create invitation error:', error);
      throw new ZegoCloudError(
        'Failed to create invitation',
        'INVITATION_CREATION_FAILED',
        { liveClassId, creatorId, inviteeId, error: error.message }
      );
    }
  }

  /**
   * Validate an invitation token
   * @param {string} invitationToken - Invitation token to validate
   * @param {number} userId - User ID attempting to use the invitation
   * @returns {Object} Validation result
   */
  async validateInvitation(invitationToken, userId) {
    try {
      if (!invitationToken || !userId) {
        throw new Error('Invitation token and user ID are required');
      }

      // Decode invitation token (simplified implementation)
      const tokenData = this.decodeInvitationToken(invitationToken);

      if (!tokenData) {
        return {
          success: false,
          valid: false,
          reason: 'Invalid invitation token',
          errorCode: 'INVALID_TOKEN'
        };
      }

      // Check if token is for this user
      if (tokenData.inviteeId !== userId) {
        return {
          success: false,
          valid: false,
          reason: 'Invitation token is not for this user',
          errorCode: 'TOKEN_USER_MISMATCH'
        };
      }

      // Check if token is expired
      if (tokenData.expiresAt && new Date() > new Date(tokenData.expiresAt)) {
        return {
          success: false,
          valid: false,
          reason: 'Invitation token has expired',
          errorCode: 'TOKEN_EXPIRED'
        };
      }

      // Token is valid
      return {
        success: true,
        valid: true,
        liveClassId: tokenData.liveClassId,
        inviteeId: tokenData.inviteeId,
        reason: 'Valid invitation token',
        validatedAt: new Date()
      };

    } catch (error) {
      console.error('Validate invitation error:', error);
      throw new ZegoCloudError(
        'Failed to validate invitation',
        'INVITATION_VALIDATION_FAILED',
        { invitationToken, userId, error: error.message }
      );
    }
  }

  /**
   * Get privacy settings for a live class
   * @param {string} liveClassId - Live class identifier
   * @returns {Object} Privacy settings
   */
  async getPrivacySettings(liveClassId) {
    try {
      const liveClass = await LiveClass.findByPk(liveClassId);
      if (!liveClass) {
        throw new Error('Live class not found');
      }

      return {
        success: true,
        liveClassId,
        privacy: liveClass.privacy,
        title: liveClass.title,
        creatorId: liveClass.userId,
        price: liveClass.price,
        requiresPurchase: liveClass.privacy === 'private' && liveClass.price > 0,
        allowsInvitations: liveClass.privacy === 'private',
        retrievedAt: new Date()
      };

    } catch (error) {
      console.error('Get privacy settings error:', error);
      throw new ZegoCloudError(
        'Failed to get privacy settings',
        'PRIVACY_SETTINGS_RETRIEVAL_FAILED',
        { liveClassId, error: error.message }
      );
    }
  }

  /**
   * Update privacy settings for a live class
   * @param {string} liveClassId - Live class identifier
   * @param {number} creatorId - Creator user ID
   * @param {Object} privacySettings - New privacy settings
   * @returns {Object} Update result
   */
  async updatePrivacySettings(liveClassId, creatorId, privacySettings) {
    try {
      if (!liveClassId || !creatorId) {
        throw new Error('Live class ID and creator ID are required');
      }

      // Verify live class exists and belongs to creator
      const liveClass = await LiveClass.findByPk(liveClassId);
      if (!liveClass) {
        throw new Error('Live class not found');
      }

      if (liveClass.userId !== creatorId) {
        throw new Error('Only the creator can update privacy settings');
      }

      // Validate privacy setting
      if (privacySettings.privacy && !['public', 'private'].includes(privacySettings.privacy)) {
        throw new Error('Privacy must be either "public" or "private"');
      }

      // Prepare update data
      const updateData = {};
      if (privacySettings.privacy) {
        updateData.privacy = privacySettings.privacy;
      }

      // Update the live class
      await liveClass.update(updateData);

      console.log(`Privacy settings updated for live class ${liveClassId}`);

      return {
        success: true,
        liveClassId,
        previousPrivacy: liveClass.privacy,
        newPrivacy: updateData.privacy || liveClass.privacy,
        updatedAt: new Date(),
        message: 'Privacy settings updated successfully'
      };

    } catch (error) {
      console.error('Update privacy settings error:', error);
      throw new ZegoCloudError(
        'Failed to update privacy settings',
        'PRIVACY_SETTINGS_UPDATE_FAILED',
        { liveClassId, creatorId, error: error.message }
      );
    }
  }

  /**
   * Generate invitation token (simplified implementation)
   * @param {string} liveClassId - Live class identifier
   * @param {number} inviteeId - Invitee user ID
   * @returns {string} Invitation token
   */
  generateInvitationToken(liveClassId, inviteeId) {
    const payload = {
      liveClassId,
      inviteeId,
      type: 'invitation',
      createdAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };

    // In a real implementation, this would use proper JWT signing
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  /**
   * Decode invitation token (simplified implementation)
   * @param {string} token - Invitation token
   * @returns {Object|null} Decoded token data
   */
  decodeInvitationToken(token) {
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64url').toString());
      
      if (payload.type !== 'invitation') {
        return null;
      }

      return payload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Format error response for privacy violations
   * @param {string} errorCode - Error code
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   * @returns {Object} Formatted error response
   */
  formatPrivacyError(errorCode, message, context = {}) {
    const errorResponses = {
      'ACCESS_DENIED': {
        httpStatus: 403,
        message: 'Access denied. Purchase required to join this private live class.',
        code: 'ACCESS_DENIED'
      },
      'INVALID_TOKEN': {
        httpStatus: 401,
        message: 'Invalid invitation token provided.',
        code: 'INVALID_TOKEN'
      },
      'TOKEN_EXPIRED': {
        httpStatus: 401,
        message: 'Invitation token has expired.',
        code: 'TOKEN_EXPIRED'
      },
      'TOKEN_USER_MISMATCH': {
        httpStatus: 403,
        message: 'Invitation token is not valid for this user.',
        code: 'TOKEN_USER_MISMATCH'
      }
    };

    const errorResponse = errorResponses[errorCode] || {
      httpStatus: 400,
      message: message || 'Privacy validation failed',
      code: errorCode || 'PRIVACY_ERROR'
    };

    return {
      success: false,
      error: {
        ...errorResponse,
        context,
        timestamp: new Date()
      }
    };
  }
}

// Export singleton instance
const zegoCloudPrivacyService = new ZegoCloudPrivacyService();

module.exports = {
  zegoCloudPrivacyService,
  ZegoCloudPrivacyService
};