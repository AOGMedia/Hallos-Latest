'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CommunityAnnouncementComment = sequelize.define('CommunityAnnouncementComment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  announcementId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'announcement_id'
  },
  communityId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'community_id'
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: 'community_announcement_comments',
  timestamps: true,
  underscored: true
});

module.exports = CommunityAnnouncementComment;
