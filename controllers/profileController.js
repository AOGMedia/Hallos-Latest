const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { upload } = require('../utils/multerConfig');

/**
 * Profile Controller
 * 
 * Handles user profile management:
 * - Get profile
 * - Update profile (name, phone, country, bio, social links)
 * - Update profile picture
 * - Change password
 * - Notification preferences
 */

/**
 * Get user profile
 * GET /api/profile
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: [
        'id',
        'firstname',
        'lastname',
        'email',
        'role',
        'phoneNumber',
        'country',
        'bio',
        'socialLinks',
        'newsletterSubscribed',
        'createdAt'
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      profile: user
    });
  } catch (error) {
    console.error('[Profile Controller] Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
};

/**
 * Update user profile
 * PATCH /api/profile
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      firstname,
      lastname,
      phoneNumber,
      country,
      bio,
      socialLinks
    } = req.body;

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Build update object
    const updates = {};
    if (firstname !== undefined) updates.firstname = firstname;
    if (lastname !== undefined) updates.lastname = lastname;
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
    if (country !== undefined) updates.country = country;
    if (bio !== undefined) updates.bio = bio;
    
    // Handle social links (must be valid JSON object)
    if (socialLinks !== undefined) {
      try {
        const parsedLinks = typeof socialLinks === 'string' 
          ? JSON.parse(socialLinks) 
          : socialLinks;
        
        // Validate it's an object
        if (typeof parsedLinks === 'object' && parsedLinks !== null) {
          updates.socialLinks = parsedLinks;
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid social links format. Must be a valid JSON object.'
        });
      }
    }

    // Update user
    await user.update(updates);

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phoneNumber: user.phoneNumber,
        country: user.country,
        bio: user.bio,
        socialLinks: user.socialLinks,
        newsletterSubscribed: user.newsletterSubscribed
      }
    });
  } catch (error) {
    console.error('[Profile Controller] Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

/**
 * Update profile picture
 * POST /api/profile/picture
 */
exports.updateProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if file was uploaded
    const profilePicture = req.files?.profilePicture?.[0] || req.files?.image?.[0] || req.files?.file?.[0];
    
    if (!profilePicture) {
      return res.status(400).json({
        success: false,
        message: 'No profile picture provided'
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get S3 URL or local path
    const profilePictureUrl = profilePicture.location || `/upload/${profilePicture.filename}`;

    // Update user (assuming you have an avatar field - if not, add it to migration)
    // For now, we'll store it in socialLinks as a workaround
    const socialLinks = user.socialLinks || {};
    socialLinks.profilePicture = profilePictureUrl;
    
    await user.update({ socialLinks });

    return res.json({
      success: true,
      message: 'Profile picture updated successfully',
      profilePictureUrl
    });
  } catch (error) {
    console.error('[Profile Controller] Update profile picture error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile picture'
    });
  }
};

/**
 * Change password
 * POST /api/profile/change-password
 */
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has a password (OAuth users might not)
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change password for OAuth accounts'
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await user.update({ password: hashedPassword });

    return res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('[Profile Controller] Change password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

/**
 * Update notification preferences
 * PATCH /api/profile/notifications
 */
exports.updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { newsletterSubscribed } = req.body;

    if (typeof newsletterSubscribed !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'newsletterSubscribed must be a boolean value'
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.update({ newsletterSubscribed });

    return res.json({
      success: true,
      message: `Newsletter ${newsletterSubscribed ? 'subscribed' : 'unsubscribed'} successfully`,
      newsletterSubscribed
    });
  } catch (error) {
    console.error('[Profile Controller] Update notification preferences error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update notification preferences'
    });
  }
};

/**
 * Get notification preferences
 * GET /api/profile/notifications
 */
exports.getNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: ['newsletterSubscribed']
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      preferences: {
        newsletterSubscribed: user.newsletterSubscribed,
        sessionReminders: true // Always enabled for purchased series
      }
    });
  } catch (error) {
    console.error('[Profile Controller] Get notification preferences error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notification preferences'
    });
  }
};

module.exports = exports;
