'use strict';
const communityService = require('../services/communityService');
const CommunityMember = require('../models/CommunityMember');
const User = require('../models/User');

function handleError(res, err) {
  const status = err.statusCode || 500;
  // Surface Sequelize validation errors clearly
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({ success: false, message: err.errors.map(e => e.message).join(', ') });
  }
  if (err.name === 'SequelizeDatabaseError') {
    return res.status(400).json({ success: false, message: err.message });
  }
  return res.status(status).json({ success: false, message: err.message });
}

const Community = require('../models/Community');

// GET /api/communities
exports.listCommunities = async (req, res) => {
  try {
    const result = await communityService.listPublicCommunities(req.query);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/my
exports.getMyCommunities = async (req, res) => {
  try {
    const result = await communityService.getMyCommunities(req.user.id, req.query);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id
exports.getCommunity = async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const { community, isMember, publicContent } = await communityService.getCommunityProfile(req.params.id, req.user && req.user.id, isAdmin);
    res.json({ success: true, data: { ...community, isMember, publicContent } });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities
exports.createCommunity = async (req, res) => {
  try {
    const posterFile = req.files?.poster?.[0] || null;
    const community = await communityService.createCommunity(req.user.id, req.body, posterFile);
    res.status(201).json({ success: true, data: community });
  } catch (err) {
    // Multer file type errors should be 400 not 500
    if (err.message && err.message.includes('Invalid file type')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    handleError(res, err);
  }
};

// GET /api/communities/invite/:token
exports.joinViaInvite = async (req, res) => {
  try {
    const member = await communityService.joinViaInvite(req.params.token, req.user.id);
    res.status(201).json({ success: true, data: member });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/join
exports.requestJoin = async (req, res) => {
  try {
    const member = await communityService.requestJoin(req.params.id, req.user.id);
    res.status(201).json({ success: true, data: member });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/communities/:id/members/me
exports.leaveCommunity = async (req, res) => {
  try {
    const member = req.communityMember;
    if (member && member.role === 'owner') {
      await communityService.ownerLeave(req.params.id, req.user.id);
    } else {
      await communityService.removeMember(req.params.id, req.user.id, req.user.id);
    }
    res.json({ success: true, message: 'Left community.' });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/communities/:id
exports.deleteCommunity = async (req, res) => {
  try {
    await communityService.deleteCommunity(req.params.id, req.user.id);
    res.json({ success: true, message: 'Community deleted.' });
  } catch (err) { handleError(res, err); }
};

// PATCH /api/communities/:id/members/me/notifications
exports.toggleNotifications = async (req, res) => {
  try {
    const { enabled } = req.body;
    const member = await communityService.toggleEmailNotifications(req.params.id, req.user.id, enabled);
    res.json({ success: true, data: member });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/announcements
exports.listAnnouncements = async (req, res) => {
  try {
    const announcements = await communityService.listAnnouncements(req.params.id, req.user?.id);
    res.json({ success: true, data: announcements });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/announcements
exports.createAnnouncement = async (req, res) => {
  try {
    const imageFile = req.files?.image?.[0] || null;
    const announcement = await communityService.createAnnouncement(req.params.id, req.user.id, req.body, imageFile);
    res.status(201).json({ success: true, data: announcement });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/announcements/:aid/like
exports.toggleAnnouncementLike = async (req, res) => {
  try {
    const result = await communityService.toggleAnnouncementLike(req.params.aid, req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/announcements/:aid/comments
exports.addAnnouncementComment = async (req, res) => {
  try {
    const comment = await communityService.addAnnouncementComment(
      req.params.aid, req.params.id, req.user.id, req.body.body
    );
    res.status(201).json({ success: true, data: comment });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/announcements/:aid/comments
exports.listAnnouncementComments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const result = await communityService.listAnnouncementComments(req.params.aid, req.params.id, page, limit);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/communities/:id/announcements/:aid/comments/:cid
exports.deleteAnnouncementComment = async (req, res) => {
  try {
    const actorRole = req.communityMember?.role || 'member';
    await communityService.deleteAnnouncementComment(req.params.cid, req.params.id, req.user.id, actorRole);
    res.json({ success: true, message: 'Comment deleted.' });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/content
exports.listContent = async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    // communityMemberMiddleware already confirmed membership — pass it directly
    const isMember = isAdmin || !!req.communityMember;
    const content = await communityService.listCommunityContent(req.params.id, req.user && req.user.id, isMember);
    res.json({ success: true, data: content });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/submissions
exports.submitContent = async (req, res) => {
  try {
    const submission = await communityService.submitContent(req.params.id, req.user.id, req.body);
    res.status(201).json({ success: true, data: submission });
  } catch (err) { handleError(res, err); }
};

// PATCH /api/communities/:id/submissions/:sid/resubmit
exports.resubmitContent = async (req, res) => {
  try {
    const submission = await communityService.resubmitContent(req.params.sid, req.user.id, req.body);
    res.json({ success: true, data: submission });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/members/:uid — view a member's profile
exports.getMemberProfile = async (req, res) => {
  try {
    const { id: communityId, uid } = req.params;
    const requesterId = req.user.id;

    // Confirm target is an active member of this community
    const targetMembership = await CommunityMember.findOne({
      where: { communityId, userId: uid, status: 'active' }
    });
    if (!targetMembership) {
      return res.status(404).json({ success: false, message: 'Member not found in this community.' });
    }

    // Determine requester's role
    const requesterMembership = await CommunityMember.findOne({
      where: { communityId, userId: requesterId, status: 'active' }
    });
    const isModOrOwner = req.user.role === 'admin' ||
      (requesterMembership && ['owner', 'moderator'].includes(requesterMembership.role));

    // Fields visible to all members
    const memberFields = ['id', 'firstname', 'lastname', 'bio', 'country', 'socialLinks', 'createdAt'];
    // Extra fields for moderators/owners
    const modFields = [...memberFields, 'email', 'phoneNumber', 'role'];

    const user = await User.findByPk(uid, {
      attributes: isModOrOwner ? modFields : memberFields
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Count their submissions in this community
    const CommunityContentSubmission = require('../models/CommunityContentSubmission');
    const submissionCount = await CommunityContentSubmission.count({
      where: { communityId, submittedBy: uid }
    });

    const profile = {
      ...user.toJSON(),
      // Extract profile picture from socialLinks
      profilePicture: user.socialLinks?.profilePicture || null,
      // Community-specific context
      community: {
        role: targetMembership.role,
        joinedAt: targetMembership.joinedAt,
        submissionCount
      }
    };

    // Moderators/owners also see email notifications setting
    if (isModOrOwner) {
      profile.community.emailNotificationsEnabled = targetMembership.emailNotificationsEnabled;
    }

    return res.json({ success: true, data: profile });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/members
exports.listMembers = async (req, res) => {
  try {
    const members = await CommunityMember.findAll({
      where: { communityId: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }]
    });
    res.json({ success: true, data: members });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/members
exports.addMember = async (req, res) => {
  try {
    const result = await communityService.addMemberByEmail(req.params.id, req.body.email, req.user.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/communities/:id/members/:uid
exports.removeMember = async (req, res) => {
  try {
    await communityService.removeMember(req.params.id, parseInt(req.params.uid), req.user.id);
    res.json({ success: true, message: 'Member removed.' });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/submissions — moderator sees all pending/resubmitted (paginated)
exports.listSubmissions = async (req, res) => {
  try {
    const CommunityContentSubmission = require('../models/CommunityContentSubmission');
    const { Op } = require('sequelize');

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await CommunityContentSubmission.findAndCountAll({
      where: {
        communityId: req.params.id,
        status: { [Op.in]: ['pending', 'resubmitted'] }
      },
      include: [{
        model: User,
        as: 'submitter',
        attributes: ['id', 'firstname', 'lastname', 'email']
      }],
      order: [['createdAt', 'ASC']],
      limit,
      offset
    });

    res.json({
      success: true,
      data: {
        total: count,
        page,
        limit,
        submissions: rows
      }
    });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/submissions/my — member sees their own submissions
exports.listMySubmissions = async (req, res) => {
  try {
    const CommunityContentSubmission = require('../models/CommunityContentSubmission');

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await CommunityContentSubmission.findAndCountAll({
      where: {
        communityId: req.params.id,
        submittedBy: req.user.id
      },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      success: true,
      data: {
        total: count,
        page,
        limit,
        submissions: rows
      }
    });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/submissions/:sid/approve
exports.approveSubmission = async (req, res) => {
  try {
    const submission = await communityService.approveSubmission(req.params.sid, req.user.id);
    res.json({ success: true, data: submission });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/submissions/:sid/reject
exports.rejectSubmission = async (req, res) => {
  try {
    const submission = await communityService.rejectSubmission(req.params.sid, req.user.id, req.body.rejectionReason);
    res.json({ success: true, data: submission });
  } catch (err) { handleError(res, err); }
};

// PATCH /api/communities/:id/announcements/:aid
exports.updateAnnouncement = async (req, res) => {
  try {
    const announcement = await communityService.updateAnnouncement(req.params.id, req.params.aid, req.user.id, req.body);
    res.json({ success: true, data: announcement });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/communities/:id/announcements/:aid
exports.deleteAnnouncement = async (req, res) => {
  try {
    await communityService.deleteAnnouncement(req.params.id, req.params.aid, req.user.id);
    res.json({ success: true, message: 'Announcement deleted.' });
  } catch (err) { handleError(res, err); }
};

// GET /api/communities/:id/invite
exports.getInviteLink = async (req, res) => {
  try {
    const result = await communityService.getInviteLink(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/invite/regenerate
exports.regenerateInvite = async (req, res) => {
  try {
    const result = await communityService.regenerateInviteToken(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/content
exports.createContentDirect = async (req, res) => {
  try {
    const { contentType, ...data } = req.body;
    const content = await communityService.createContentDirect(req.params.id, req.user.id, contentType, data);
    res.status(201).json({ success: true, data: content });
  } catch (err) { handleError(res, err); }
};

// PATCH /api/communities/:id
exports.updateCommunity = async (req, res) => {
  try {
    const community = await Community.findByPk(req.params.id);
    if (!community) return res.status(404).json({ success: false, message: 'Community not found.' });

    const posterFile = req.files?.poster?.[0] || null;
    let thumbnailUrl = community.thumbnailUrl;

    if (posterFile) {
      const { uploadFileToS3, deleteFileFromS3 } = require('../services/s3Service');
      // Delete old poster from S3 if it exists
      if (thumbnailUrl && thumbnailUrl.startsWith('https://')) {
        deleteFileFromS3(thumbnailUrl).catch(e =>
          console.error('[Community] Failed to delete old poster from S3:', e.message)
        );
      }
      if (posterFile.location) {
        // multer-s3: already uploaded, just use the URL
        thumbnailUrl = posterFile.location;
      } else if (posterFile.buffer) {
        // memory storage: upload manually
        const result = await uploadFileToS3(posterFile.buffer, posterFile.originalname, posterFile.mimetype, 'communities');
        thumbnailUrl = result.url;
      }
    }

    await community.update({ ...req.body, thumbnailUrl });
    res.json({ success: true, data: community });
  } catch (err) { handleError(res, err); }
};

// PATCH /api/communities/:id/members/:uid/role
exports.updateMemberRole = async (req, res) => {
  try {
    const { role } = req.body;
    let result;
    if (role === 'moderator') {
      result = await communityService.assignModerator(req.params.id, parseInt(req.params.uid), req.user.id);
    } else if (role === 'member') {
      result = await communityService.revokeModerator(req.params.id, parseInt(req.params.uid), req.user.id);
    } else {
      return res.status(400).json({ success: false, message: 'Role must be moderator or member.' });
    }
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/transfer-ownership
exports.transferOwnership = async (req, res) => {
  try {
    const result = await communityService.transferOwnership(req.params.id, req.user.id, req.body.newOwnerId);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/join-requests/:uid/approve
exports.approveJoinRequest = async (req, res) => {
  try {
    const member = await communityService.approveJoinRequest(req.params.id, req.params.uid, req.user.id);
    res.json({ success: true, data: member });
  } catch (err) { handleError(res, err); }
};

// POST /api/communities/:id/join-requests/:uid/reject
exports.rejectJoinRequest = async (req, res) => {
  try {
    const member = await communityService.rejectJoinRequest(req.params.id, req.params.uid, req.user.id);
    res.json({ success: true, data: member });
  } catch (err) { handleError(res, err); }
};
