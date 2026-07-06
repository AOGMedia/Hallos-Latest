'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Community = sequelize.define('Community', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  thumbnailUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'thumbnail_url'
  },
  coverImageUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'cover_image_url'
  },
  type: {
    type: DataTypes.ENUM('school', 'association', 'committee', 'general'),
    allowNull: false
  },
  visibility: {
    type: DataTypes.ENUM('public', 'private'),
    allowNull: false
  },
  joinPolicy: {
    type: DataTypes.ENUM('request', 'invite_only'),
    allowNull: false,
    defaultValue: 'request',
    field: 'join_policy'
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'suspended', 'rejected'),
    allowNull: false,
    defaultValue: 'pending'
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'created_by'
  },
  inviteToken: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    field: 'invite_token'
  },
  memberCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'member_count'
  }
}, {
  tableName: 'communities',
  timestamps: true,
  underscored: true
});

module.exports = Community;
