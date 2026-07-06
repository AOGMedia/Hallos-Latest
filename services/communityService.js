'use strict';
const crypto = require('crypto');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const Community = require('../models/Community');
const CommunityMember = require('../models/CommunityMember');
const CommunityAnnouncement = require('../models/CommunityAnnouncement');
const CommunityAnnouncementComment = require('../models/CommunityAnnouncementComment');
const CommunityContentSubmission = require('../models/CommunityContentSubmission');
const User = require('../models/User');
const LiveClass = require('../models/liveClass');
const LiveSeries = require('../models/LiveSeries');
const Video = require('../models/Video');
const Freebie = require('../models/Freebie');
const emailUtil = require('../utils/email');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex
}

async function getLiveMemberCount(communityId) {
  return CommunityMember.count({ where: { communityId, status: 'active' } });
}

const CONTENT_MODEL_MAP = {
  video: Video,
  live_class: LiveClass,
  live_series: LiveSeries,
  freebie: Freebie
};

// ---------------------------------------------------------------------------
// 1. Community Creation
// ---------------------------------------------------------------------------

exports.createCommunity = async (userId, data, posterFile = null) => {
  const { name, description, type, visibility, joinPolicy } = data;
  const inviteToken = generateInviteToken();

  let thumbnailUrl = null;
  if (posterFile) {
    if (posterFile.location) {
      // multer-s3: already uploaded to S3, just use the URL
      thumbnailUrl = posterFile.location;
    } else if (posterFile.buffer) {
      // memory storage: upload manually
      const { uploadFileToS3 } = require('../services/s3Service');
      const result = await uploadFileToS3(posterFile.buffer, posterFile.originalname, posterFile.mimetype, 'communities');
      thumbnailUrl = result.url;
    }
  }

  const t = await sequelize.transaction();
  try {
    const community = await Community.create({
      name,
      description,
      type,
      visibility,
      joinPolicy: joinPolicy || 'request',
      status: 'pending',
      createdBy: userId,
      inviteToken,
      thumbnailUrl
    }, { transaction: t });

    await CommunityMember.create({
      communityId: community.id,
      userId,
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    }, { transaction: t });

    await t.commit();
    return community;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

// ---------------------------------------------------------------------------
// 2. Admin Status Transitions
// ---------------------------------------------------------------------------

exports.approveCommunity = async (communityId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);
  await community.update({ status: 'active' });
  return community;
};

exports.rejectCommunity = async (communityId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);
  await community.update({ status: 'rejected' });

  // Email creator
  const creator = await User.findByPk(community.createdBy);
  if (creator) {
    emailUtil.sendCommunityStatusEmail(creator.email, creator.firstname, community.name, 'rejected')
      .catch(err => console.error('[CommunityService] rejectCommunity email error:', err.message));
  }
  return community;
};

exports.suspendCommunity = async (communityId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);
  await community.update({ status: 'suspended' });

  // Email owner
  const owner = await CommunityMember.findOne({
    where: { communityId, role: 'owner', status: 'active' },
    include: [{ model: User, as: 'user' }]
  });
  if (owner && owner.user) {
    emailUtil.sendCommunityStatusEmail(owner.user.email, owner.user.firstname, community.name, 'suspended')
      .catch(err => console.error('[CommunityService] suspendCommunity email error:', err.message));
  }
  return community;
};

// ---------------------------------------------------------------------------
// 3. Discovery
// ---------------------------------------------------------------------------

exports.getMyCommunities = async (userId, filters = {}) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;

  const { count, rows: memberships } = await CommunityMember.findAndCountAll({
    where: { userId },
    include: [{ model: Community, as: 'community' }],
    order: [['joinedAt', 'DESC']],
    limit,
    offset
  });

  const communities = await Promise.all(
    memberships
      .filter(m => m.community)
      .map(async (m) => ({
        ...m.community.toJSON(),
        memberCount: await getLiveMemberCount(m.community.id),
        membershipStatus: m.status,
        memberRole: m.role,
        joinedAt: m.joinedAt
      }))
  );

  return {
    total: count,
    page,
    limit,
    communities
  };
};

exports.listPublicCommunities = async (filters = {}) => {
  const where = { status: 'active', visibility: 'public' };
  if (filters.type) where.type = filters.type;
  if (filters.name) where.name = { [Op.iLike]: `%${filters.name}%` };

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;

  const { count, rows } = await Community.findAndCountAll({ where, limit, offset, order: [['createdAt', 'DESC']] });

  const communities = await Promise.all(rows.map(async (c) => ({
    ...c.toJSON(),
    memberCount: await getLiveMemberCount(c.id)
  })));

  return { total: count, page, limit, communities };
};

exports.listAllCommunities = async (filters = {}) => {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.visibility) where.visibility = filters.visibility;
  if (filters.name) where.name = { [Op.iLike]: `%${filters.name}%` };

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;

  const { count, rows } = await Community.findAndCountAll({ where, limit, offset, order: [['createdAt', 'DESC']] });
  return { total: count, page, limit, communities: rows };
};

// ---------------------------------------------------------------------------
// 4. Community Profile
// ---------------------------------------------------------------------------

exports.getCommunityProfile = async (communityId, requestingUserId, isAdmin = false) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);

  if (community.status === 'pending' && !isAdmin) {
    throw makeError('Community not found.', 404);
  }
  if (community.status === 'suspended' && !isAdmin) {
    throw makeError('This community is currently suspended.', 403);
  }

  // Check membership status
  let isMember = isAdmin;
  let membershipStatus = null; // null = not a member, 'pending', 'active', 'banned'

  if (!isAdmin && requestingUserId) {
    const membership = await CommunityMember.findOne({
      where: { communityId, userId: requestingUserId }
    });
    if (membership) {
      membershipStatus = membership.status;
      isMember = membership.status === 'active';
    }
  } else if (isAdmin) {
    membershipStatus = 'active';
  }

  if (community.visibility === 'private' && !isMember && membershipStatus !== 'pending') {
    throw makeError('Community not found.', 404);
  }

  // Fetch content — members see all, non-members see public only
  const contentWhere = isMember ? { communityId } : { communityId, communityVisibility: 'public' };
  const [videos, liveClasses, liveSeries, freebies] = await Promise.all([
    Video.findAll({ where: contentWhere, attributes: ['id', 'title', 'thumbnailUrl', 'price', 'currency'] }),
    LiveClass.findAll({ where: contentWhere, attributes: ['id', 'title', 'thumbnailUrl', 'price', 'currency'] }),
    LiveSeries.findAll({ where: contentWhere, attributes: ['id', 'title', 'thumbnailUrl', 'price', 'currency'] }),
    Freebie.findAll({ where: contentWhere, attributes: ['id', 'title', 'thumbnailUrl', 'price', 'currency'] })
  ]);

  return {
    community: {
      ...community.toJSON(),
      memberCount: await getLiveMemberCount(communityId)
    },
    isMember,
    membershipStatus,
    publicContent: { videos, liveClasses, liveSeries, freebies }
  };
};

// ---------------------------------------------------------------------------
// 5. Join Flow
// ---------------------------------------------------------------------------

exports.requestJoin = async (communityId, userId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);
  if (community.status !== 'active') throw makeError('Community is not active.', 403);

  const existing = await CommunityMember.findOne({
    where: { communityId, userId, status: { [Op.in]: ['active', 'pending'] } }
  });
  if (existing) throw makeError('You already have a pending or active membership in this community.', 409);

  return CommunityMember.create({ communityId, userId, role: 'member', status: 'pending' });
};

exports.joinViaInvite = async (token, userId) => {
  const community = await Community.findOne({ where: { inviteToken: token } });
  if (!community) throw makeError('Invalid invite link.', 404);
  return exports.requestJoin(community.id, userId);
};

exports.approveJoinRequest = async (communityId, targetUserId, actorId) => {
  const member = await CommunityMember.findOne({ where: { communityId, userId: targetUserId } });
  if (!member) throw makeError('Join request not found.', 404);

  const t = await sequelize.transaction();
  try {
    await member.update({ status: 'active', joinedAt: new Date() }, { transaction: t });
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // Send confirmation email (fire-and-forget)
  const user = await User.findByPk(targetUserId);
  const community = await Community.findByPk(communityId);
  if (user && community) {
    emailUtil.sendCommunityJoinConfirmationEmail(user.email, user.firstname, community.name)
      .catch(err => console.error('[CommunityService] approveJoinRequest email error:', err.message));
  }

  return member;
};

exports.rejectJoinRequest = async (communityId, targetUserId, actorId) => {
  const member = await CommunityMember.findOne({ where: { communityId, userId: targetUserId } });
  if (!member) throw makeError('Join request not found.', 404);
  await member.update({ status: 'banned' });
  return member;
};

// ---------------------------------------------------------------------------
// 6. Member Management
// ---------------------------------------------------------------------------

exports.addMemberByEmail = async (communityId, email, actorId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);

  const user = await User.findOne({ where: { email } });

  if (!user) {
    // Not on platform — send signup invite email (fire-and-forget)
    emailUtil.sendCommunityInviteEmail(email, community.name, community.inviteToken)
      .catch(err => console.error('[CommunityService] addMemberByEmail invite error:', err.message));
    return { invited: true, registered: false, email };
  }

  // Already on platform — check for existing membership
  const existing = await CommunityMember.findOne({
    where: { communityId, userId: user.id, status: { [Op.in]: ['active', 'pending'] } }
  });
  if (existing) throw makeError('User already has a pending or active membership.', 409);

  // Add as pending — they must accept the invite
  const t = await sequelize.transaction();
  try {
    const member = await CommunityMember.create({
      communityId, userId: user.id, role: 'member', status: 'pending',
      invitedBy: actorId
    }, { transaction: t });
    await t.commit();

    // Send invite notification email (fire-and-forget)
    emailUtil.sendCommunityMemberInviteEmail(
      user.email, user.firstname, community.name, community.inviteToken
    ).catch(err => console.error('[CommunityService] member invite email error:', err.message));

    return { invited: true, registered: true, email, memberId: member.id };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

exports.removeMember = async (communityId, targetUserId, actorId) => {
  const target = await CommunityMember.findOne({ where: { communityId, userId: targetUserId, status: 'active' } });
  if (!target) throw makeError('Member not found.', 404);

  // Owner cannot be removed — only via transferOwnership or ownerLeave
  if (target.role === 'owner') throw makeError('The owner cannot be removed. Use transfer ownership instead.', 403);

  // If actor is not removing themselves, check their rank
  if (actorId !== targetUserId) {
    const actor = await CommunityMember.findOne({ where: { communityId, userId: actorId, status: 'active' } });
    if (actor && actor.role === 'moderator' && target.role === 'moderator') {
      throw makeError('Moderators cannot remove other moderators.', 403);
    }
  }

  const t = await sequelize.transaction();
  try {
    await target.destroy({ transaction: t });
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
  // Content records are NOT deleted — community_id remains intact
};

exports.assignModerator = async (communityId, targetUserId, actorId) => {
  // Only owner can assign moderators
  const actor = await CommunityMember.findOne({ where: { communityId, userId: actorId, status: 'active' } });
  if (!actor || actor.role !== 'owner') throw makeError('Only the owner can assign moderators.', 403);

  const member = await CommunityMember.findOne({ where: { communityId, userId: targetUserId, status: 'active' } });
  if (!member) throw makeError('Member not found.', 404);
  if (member.role === 'owner') throw makeError('Cannot change the owner\'s role.', 403);
  if (member.role === 'moderator') throw makeError('User is already a moderator.', 400);

  await member.update({ role: 'moderator' });
  return member;
};

exports.revokeModerator = async (communityId, targetUserId, actorId) => {
  // Only owner can revoke moderators
  const actor = await CommunityMember.findOne({ where: { communityId, userId: actorId, status: 'active' } });
  if (!actor || actor.role !== 'owner') throw makeError('Only the owner can revoke moderators.', 403);

  const member = await CommunityMember.findOne({ where: { communityId, userId: targetUserId, status: 'active' } });
  if (!member) throw makeError('Member not found.', 404);
  if (member.role === 'owner') throw makeError('Cannot change the owner\'s role.', 403);
  if (member.role === 'member') throw makeError('User is already a regular member.', 400);

  await member.update({ role: 'member' });
  return member;
};

exports.toggleEmailNotifications = async (communityId, userId, enabled) => {
  const member = await CommunityMember.findOne({ where: { communityId, userId, status: 'active' } });
  if (!member) throw makeError('Member not found.', 404);
  await member.update({ emailNotificationsEnabled: enabled });
  return member;
};

// ---------------------------------------------------------------------------
// 7. Invite Token Management
// ---------------------------------------------------------------------------

exports.getInviteLink = async (communityId, actorId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);
  return { inviteToken: community.inviteToken };
};

exports.regenerateInviteToken = async (communityId, actorId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);
  const newToken = generateInviteToken();
  await community.update({ inviteToken: newToken });
  return { inviteToken: newToken };
};

// ---------------------------------------------------------------------------
// 8. Ownership Transfer (explicit)
// ---------------------------------------------------------------------------

exports.transferOwnership = async (communityId, ownerId, newOwnerId) => {
  const ownerMember = await CommunityMember.findOne({ where: { communityId, userId: ownerId, role: 'owner', status: 'active' } });
  if (!ownerMember) throw makeError('Owner role required.', 403);

  const targetMember = await CommunityMember.findOne({ where: { communityId, userId: newOwnerId, status: 'active' } });
  if (!targetMember) throw makeError('Target user is not an active member of this community.', 404);

  const t = await sequelize.transaction();
  try {
    await ownerMember.update({ role: 'member' }, { transaction: t });
    await targetMember.update({ role: 'owner' }, { transaction: t });
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // Email new owner (fire-and-forget)
  const newOwner = await User.findByPk(newOwnerId);
  const community = await Community.findByPk(communityId);
  if (newOwner && community) {
    emailUtil.sendCommunityOwnershipTransferEmail(newOwner.email, newOwner.firstname, community.name)
      .catch(err => console.error('[CommunityService] transferOwnership email error:', err.message));
  }

  return targetMember;
};

// ---------------------------------------------------------------------------
// 9. Announcements
// ---------------------------------------------------------------------------

exports.createAnnouncement = async (communityId, actorId, data, imageFile = null) => {
  const { title, body, isPinned } = data;

  let imageUrl = null;
  if (imageFile) {
    if (imageFile.location) {
      // multer-s3: already uploaded directly to S3
      imageUrl = imageFile.location;
    } else if (imageFile.buffer) {
      // memory storage: upload manually
      const { uploadFileToS3 } = require('./s3Service');
      const result = await uploadFileToS3(imageFile.buffer, imageFile.originalname, imageFile.mimetype, 'communities');
      imageUrl = result.url;
    }
  }

  const announcement = await CommunityAnnouncement.create({
    communityId, createdBy: actorId, title, body,
    imageUrl,
    isPinned: isPinned || false
  });

  // Fire-and-forget batch email
  setImmediate(async () => {
    try {
      const members = await CommunityMember.findAll({
        where: { communityId, status: 'active', emailNotificationsEnabled: true },
        include: [{ model: User, as: 'user', attributes: ['email', 'firstname'] }]
      });
      const community = await Community.findByPk(communityId);
      for (const m of members) {
        if (!m.user) continue;
        emailUtil.sendCommunityAnnouncementEmail(m.user.email, m.user.firstname, community.name, title, body)
          .catch(err => console.error(`[CommunityService] announcement email failed for ${m.user.email}:`, err.message));
      }
    } catch (err) {
      console.error('[CommunityService] announcement batch email error:', err.message);
    }
  });

  return announcement;
};

exports.listAnnouncements = async (communityId, requestingUserId) => {
  const announcements = await CommunityAnnouncement.findAll({
    where: { communityId },
    include: [
      { model: User, as: 'author', attributes: ['id', 'firstname', 'lastname', 'socialLinks'] }
    ],
    order: [['isPinned', 'DESC'], ['createdAt', 'DESC']]
  });

  return announcements.map(a => {
    const json = a.toJSON();
    return {
      ...json,
      author: {
        id: json.author?.id,
        firstname: json.author?.firstname,
        lastname: json.author?.lastname,
        profilePicture: json.author?.socialLinks?.profilePicture || null
      },
      likeCount: (json.likedBy || []).length,
      likedByMe: requestingUserId ? (json.likedBy || []).includes(requestingUserId) : false
    };
  });
};

exports.toggleAnnouncementLike = async (announcementId, communityId, userId) => {
  const announcement = await CommunityAnnouncement.findOne({ where: { id: announcementId, communityId } });
  if (!announcement) throw makeError('Announcement not found.', 404);

  const likedBy = announcement.likedBy || [];
  const alreadyLiked = likedBy.includes(userId);

  const updatedLikes = alreadyLiked
    ? likedBy.filter(id => id !== userId)
    : [...likedBy, userId];

  await announcement.update({ likedBy: updatedLikes });

  return {
    liked: !alreadyLiked,
    likeCount: updatedLikes.length
  };
};

exports.addAnnouncementComment = async (announcementId, communityId, userId, body) => {
  if (!body || !body.trim()) throw makeError('Comment body is required.', 400);

  const announcement = await CommunityAnnouncement.findOne({ where: { id: announcementId, communityId } });
  if (!announcement) throw makeError('Announcement not found.', 404);

  const comment = await CommunityAnnouncementComment.create({
    announcementId, communityId, userId, body: body.trim()
  });

  // Return with author info
  const withAuthor = await CommunityAnnouncementComment.findByPk(comment.id, {
    include: [{ model: User, as: 'author', attributes: ['id', 'firstname', 'lastname', 'socialLinks'] }]
  });

  const json = withAuthor.toJSON();
  return {
    ...json,
    author: {
      id: json.author?.id,
      firstname: json.author?.firstname,
      lastname: json.author?.lastname,
      profilePicture: json.author?.socialLinks?.profilePicture || null
    }
  };
};

exports.listAnnouncementComments = async (announcementId, communityId, page = 1, limit = 20) => {
  const announcement = await CommunityAnnouncement.findOne({ where: { id: announcementId, communityId } });
  if (!announcement) throw makeError('Announcement not found.', 404);

  const offset = (page - 1) * limit;
  const { count, rows } = await CommunityAnnouncementComment.findAndCountAll({
    where: { announcementId },
    include: [{ model: User, as: 'author', attributes: ['id', 'firstname', 'lastname', 'socialLinks'] }],
    order: [['createdAt', 'ASC']],
    limit,
    offset
  });

  return {
    total: count,
    page,
    limit,
    comments: rows.map(c => {
      const json = c.toJSON();
      return {
        ...json,
        author: {
          id: json.author?.id,
          firstname: json.author?.firstname,
          lastname: json.author?.lastname,
          profilePicture: json.author?.socialLinks?.profilePicture || null
        }
      };
    })
  };
};

exports.deleteAnnouncementComment = async (commentId, communityId, userId, actorRole) => {
  const comment = await CommunityAnnouncementComment.findOne({ where: { id: commentId, communityId } });
  if (!comment) throw makeError('Comment not found.', 404);

  // Only the comment author or a moderator/owner can delete
  const canDelete = comment.userId === userId || ['owner', 'moderator'].includes(actorRole);
  if (!canDelete) throw makeError('You cannot delete this comment.', 403);

  await comment.destroy();
};

exports.updateAnnouncement = async (communityId, announcementId, actorId, data) => {
  const announcement = await CommunityAnnouncement.findOne({ where: { id: announcementId, communityId } });
  if (!announcement) throw makeError('Announcement not found.', 404);
  await announcement.update(data);
  return announcement;
};

exports.deleteAnnouncement = async (communityId, announcementId, actorId) => {
  const announcement = await CommunityAnnouncement.findOne({ where: { id: announcementId, communityId } });
  if (!announcement) throw makeError('Announcement not found.', 404);
  await announcement.destroy();
};

// ---------------------------------------------------------------------------
// 10. Content Submissions
// ---------------------------------------------------------------------------

exports.submitContent = async (communityId, userId, data) => {
  const { contentType, contentData } = data;
  return CommunityContentSubmission.create({
    communityId, submittedBy: userId, contentType,
    contentData, status: 'pending'
  });
};

exports.approveSubmission = async (submissionId, actorId) => {
  const submission = await CommunityContentSubmission.findByPk(submissionId);
  if (!submission) throw makeError('Submission not found.', 404);
  if (submission.status !== 'pending' && submission.status !== 'resubmitted') {
    throw makeError('Submission is not pending review.', 400);
  }

  const Model = CONTENT_MODEL_MAP[submission.contentType];
  if (!Model) throw makeError('Unknown content type.', 400);

  const t = await sequelize.transaction();
  try {
    if (submission.contentData.id) {
      // Content already exists (submitted via link flow) — just update communityId
      await Model.update(
        {
          communityId: submission.communityId,
          communityVisibility: submission.contentData.communityVisibility || 'community_only'
        },
        { where: { id: submission.contentData.id }, transaction: t }
      );
    } else {
      // Content doesn't exist yet — create it (original submission flow)
      await Model.create({
        ...submission.contentData,
        communityId: submission.communityId
      }, { transaction: t });
    }

    await submission.update({
      status: 'approved',
      reviewedBy: actorId,
      reviewedAt: new Date()
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
  return submission;
};

exports.rejectSubmission = async (submissionId, actorId, reason) => {
  if (!reason || !reason.trim()) throw makeError('Rejection reason is required.', 400);

  const submission = await CommunityContentSubmission.findByPk(submissionId);
  if (!submission) throw makeError('Submission not found.', 404);

  await submission.update({
    status: 'rejected',
    rejectionReason: reason,
    reviewedBy: actorId,
    reviewedAt: new Date()
  });
  return submission;
};

exports.resubmitContent = async (submissionId, userId, data) => {
  const submission = await CommunityContentSubmission.findByPk(submissionId);
  if (!submission) throw makeError('Submission not found.', 404);
  if (submission.submittedBy !== userId) throw makeError('Forbidden.', 403);
  if (submission.status !== 'rejected') throw makeError('Only rejected submissions can be resubmitted.', 400);

  await submission.update({ status: 'resubmitted', contentData: data.contentData });
  return submission;
};

// ---------------------------------------------------------------------------
// 11. Direct Content Creation (moderator/owner bypass queue)
// ---------------------------------------------------------------------------

exports.createContentDirect = async (communityId, actorId, contentType, data) => {
  const Model = CONTENT_MODEL_MAP[contentType];
  if (!Model) throw makeError('Unknown content type.', 400);

  // Always enforce communityId and default communityVisibility
  return Model.create({
    ...data,
    userId: data.userId || actorId,
    communityId,
    communityVisibility: data.communityVisibility || 'community_only'
  });
};

// ---------------------------------------------------------------------------
// 12. Community Content Listing
// ---------------------------------------------------------------------------

exports.listCommunityContent = async (communityId, requestingUserId, isMember = false) => {
  const where = { communityId };
  if (!isMember) where.communityVisibility = 'public';

  const attrs = isMember ? null : ['id', 'title', 'thumbnailUrl', 'price', 'currency'];
  const opts = attrs ? { where, attributes: attrs } : { where };

  const [videos, liveClasses, liveSeries, freebies] = await Promise.all([
    Video.findAll(opts),
    LiveClass.findAll(opts),
    LiveSeries.findAll(opts),
    Freebie.findAll(opts)
  ]);

  return { videos, liveClasses, liveSeries, freebies };
};

// ---------------------------------------------------------------------------
// 13. Ownership Transfer on Leave
// ---------------------------------------------------------------------------

async function countCommunityContent(communityId) {
  const [v, lc, ls, f] = await Promise.all([
    Video.count({ where: { communityId } }),
    LiveClass.count({ where: { communityId } }),
    LiveSeries.count({ where: { communityId } }),
    Freebie.count({ where: { communityId } })
  ]);
  return v + lc + ls + f;
}

exports.ownerLeave = async (communityId, ownerId) => {
  const ownerMember = await CommunityMember.findOne({ where: { communityId, userId: ownerId, role: 'owner', status: 'active' } });
  if (!ownerMember) throw makeError('Owner not found.', 404);

  const otherActiveCount = await CommunityMember.count({
    where: { communityId, status: 'active', userId: { [Op.ne]: ownerId } }
  });
  const contentCount = await countCommunityContent(communityId);

  const t = await sequelize.transaction();
  try {
    if (otherActiveCount === 0 && contentCount === 0) {
      // Delete community entirely
      await Community.destroy({ where: { id: communityId }, transaction: t });
    } else {
      // Find earliest moderator
      const earliestModerator = await CommunityMember.findOne({
        where: { communityId, role: 'moderator', status: 'active' },
        order: [['joinedAt', 'ASC']]
      });

      if (earliestModerator) {
        await earliestModerator.update({ role: 'owner' }, { transaction: t });
        await ownerMember.destroy({ transaction: t });

        // Email new owner (fire-and-forget)
        const newOwnerUser = await User.findByPk(earliestModerator.userId);
        const community = await Community.findByPk(communityId);
        if (newOwnerUser && community) {
          emailUtil.sendCommunityOwnershipTransferEmail(newOwnerUser.email, newOwnerUser.firstname, community.name)
            .catch(err => console.error('[CommunityService] ownerLeave email error:', err.message));
        }
      } else {
        // No moderators — set pending, notify admin
        await Community.update({ status: 'pending' }, { where: { id: communityId }, transaction: t });
        await ownerMember.destroy({ transaction: t });

        // Email platform admin (fire-and-forget)
        const adminUsers = await User.findAll({ where: { role: 'admin' } });
        const community = await Community.findByPk(communityId);
        for (const admin of adminUsers) {
          emailUtil.sendCommunityOwnerlessEmail(admin.email, admin.firstname, community ? community.name : communityId)
            .catch(err => console.error('[CommunityService] ownerless email error:', err.message));
        }
      }
    }
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

// ---------------------------------------------------------------------------
// 14. Community Deletion (owner)
// ---------------------------------------------------------------------------

exports.deleteCommunity = async (communityId, actorId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);

  const ownerMember = await CommunityMember.findOne({ where: { communityId, userId: actorId, role: 'owner', status: 'active' } });
  if (!ownerMember) throw makeError('Owner role required.', 403);

  const otherActiveCount = await CommunityMember.count({
    where: { communityId, status: 'active', userId: { [Op.ne]: actorId } }
  });
  const contentCount = await countCommunityContent(communityId);

  if (otherActiveCount > 0 || contentCount > 0) {
    throw makeError('Cannot delete community with active members or content. Remove all members and content first.', 409);
  }

  await community.destroy();
};

// ---------------------------------------------------------------------------
// 15. Admin Deletion (cascade)
// ---------------------------------------------------------------------------

exports.adminDeleteCommunity = async (communityId) => {
  const community = await Community.findByPk(communityId);
  if (!community) throw makeError('Community not found.', 404);

  // Nullify community_id on content records before deleting community
  await Promise.all([
    Video.update({ communityId: null, communityVisibility: null }, { where: { communityId } }),
    LiveClass.update({ communityId: null, communityVisibility: null }, { where: { communityId } }),
    LiveSeries.update({ communityId: null, communityVisibility: null }, { where: { communityId } }),
    Freebie.update({ communityId: null, communityVisibility: null }, { where: { communityId } })
  ]);

  // ON DELETE CASCADE handles community_members, community_announcements, community_content_submissions
  await community.destroy();
};

// ---------------------------------------------------------------------------
// 16. Admin Delete Content
// ---------------------------------------------------------------------------

exports.adminDeleteContent = async (communityId, contentId, contentType) => {
  const Model = CONTENT_MODEL_MAP[contentType];
  if (!Model) throw makeError('Unknown content type.', 400);

  const record = await Model.findOne({ where: { id: contentId, communityId } });
  if (!record) throw makeError('Content not found.', 404);

  await record.destroy();

  // Also clean up any approved submission that spawned this content
  await CommunityContentSubmission.destroy({
    where: { communityId, status: 'approved', contentType }
  });
};
