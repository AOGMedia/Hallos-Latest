'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const NotificationPreference = sequelize.define('NotificationPreference', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    field: 'user_id'
  },
  // Send email immediately when a creator they know creates a live class
  instantLiveClassEmails: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'instant_live_class_emails'
  },
  // Receive a daily digest of upcoming live classes
  dailyDigestEmails: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'daily_digest_emails'
  },
  // Receive a weekly digest of upcoming live classes
  weeklyDigestEmails: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'weekly_digest_emails'
  },
  // Only notify about creators the user has interacted with
  allowCreatorRelatedOnly: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'allow_creator_related_only'
  },
  // Master kill switch — no emails at all
  disableAllEmails: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'disable_all_emails'
  }
}, {
  tableName: 'notification_preferences',
  timestamps: true,
  underscored: true
});

module.exports = NotificationPreference;
