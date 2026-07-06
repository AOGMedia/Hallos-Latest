'use strict';
const Community = require('./Community');
const CommunityMember = require('./CommunityMember');
const CommunityAnnouncement = require('./CommunityAnnouncement');
const CommunityAnnouncementComment = require('./CommunityAnnouncementComment');
const CommunityContentSubmission = require('./CommunityContentSubmission');
const User = require('./User');
const LiveClass = require('./liveClass');
const LiveSeries = require('./LiveSeries');
const Video = require('./Video');
const Freebie = require('./Freebie');

// Community core associations
Community.hasMany(CommunityMember, { foreignKey: 'communityId', as: 'members', onDelete: 'CASCADE' });
CommunityMember.belongsTo(Community, { foreignKey: 'communityId', as: 'community' });

Community.hasMany(CommunityAnnouncement, { foreignKey: 'communityId', as: 'announcements', onDelete: 'CASCADE' });
CommunityAnnouncement.belongsTo(Community, { foreignKey: 'communityId', as: 'community' });

Community.hasMany(CommunityContentSubmission, { foreignKey: 'communityId', as: 'submissions', onDelete: 'CASCADE' });
CommunityContentSubmission.belongsTo(Community, { foreignKey: 'communityId', as: 'community' });

// Announcement comments associations
CommunityAnnouncement.hasMany(CommunityAnnouncementComment, { foreignKey: 'announcementId', as: 'comments', onDelete: 'CASCADE' });
CommunityAnnouncementComment.belongsTo(CommunityAnnouncement, { foreignKey: 'announcementId', as: 'announcement' });
CommunityAnnouncementComment.belongsTo(User, { foreignKey: 'userId', as: 'author' });

// User associations
Community.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
CommunityMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
CommunityAnnouncement.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });
CommunityContentSubmission.belongsTo(User, { foreignKey: 'submittedBy', as: 'submitter' });

// Content table associations
LiveClass.belongsTo(Community, { foreignKey: 'communityId', as: 'community' });
Community.hasMany(LiveClass, { foreignKey: 'communityId', as: 'liveClasses' });

LiveSeries.belongsTo(Community, { foreignKey: 'communityId', as: 'community' });
Community.hasMany(LiveSeries, { foreignKey: 'communityId', as: 'liveSeries' });

Video.belongsTo(Community, { foreignKey: 'communityId', as: 'community' });
Community.hasMany(Video, { foreignKey: 'communityId', as: 'videos' });

Freebie.belongsTo(Community, { foreignKey: 'communityId', as: 'community' });
Community.hasMany(Freebie, { foreignKey: 'communityId', as: 'freebies' });

module.exports = {
  Community,
  CommunityMember,
  CommunityAnnouncement,
  CommunityAnnouncementComment,
  CommunityContentSubmission
};
