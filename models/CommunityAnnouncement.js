'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CommunityAnnouncement = sequelize.define('CommunityAnnouncement', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  communityId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'community_id'
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'created_by'
  },
  title: {
    type: DataTypes.STRING(300),
    allowNull: false
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  imageUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'image_url'
  },
  isPinned: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_pinned'
  },
  likedBy: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'liked_by'
  }
}, {
  tableName: 'community_announcements',
  timestamps: true,
  underscored: true
});

module.exports = CommunityAnnouncement;
