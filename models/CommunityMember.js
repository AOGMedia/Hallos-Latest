'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CommunityMember = sequelize.define('CommunityMember', {
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
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  role: {
    type: DataTypes.ENUM('owner', 'moderator', 'member'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'pending', 'banned'),
    allowNull: false,
    defaultValue: 'pending'
  },
  joinedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'joined_at'
  },
  invitedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'invited_by'
  },
  emailNotificationsEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'email_notifications_enabled'
  }
}, {
  tableName: 'community_members',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['community_id', 'user_id'] }
  ]
});

module.exports = CommunityMember;
