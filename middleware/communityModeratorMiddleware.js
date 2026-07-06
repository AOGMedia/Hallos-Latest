'use strict';
const CommunityMember = require('../models/CommunityMember');

/**
 * Verifies the authenticated user is an active moderator or owner of the community.
 * Platform admins bypass this check.
 * Sets req.communityMember on success.
 * Must run after authMiddleware.
 */
module.exports = async (req, res, next) => {
  try {
    // Platform admins bypass community role checks
    if (req.user && req.user.role === 'admin') {
      return next();
    }

    const communityId = req.params.id;
    const userId = req.user && req.user.id;

    if (!userId) {
      return res.status(401).json({ message: 'Access denied, token missing.' });
    }

    const member = await CommunityMember.findOne({
      where: { communityId, userId, status: 'active' }
    });

    if (!member) {
      return res.status(403).json({ message: 'Community membership required.' });
    }

    if (member.role === 'member') {
      return res.status(403).json({ message: 'Moderator or owner role required.' });
    }

    req.communityMember = member;
    next();
  } catch (err) {
    next(err);
  }
};
