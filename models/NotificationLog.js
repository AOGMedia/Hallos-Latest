'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const NotificationLog = sequelize.define('NotificationLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  contentType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'content_type'
  },
  contentId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'content_id'
  },
  notificationType: {
    type: DataTypes.ENUM('instant', 'daily_digest', 'weekly_digest', 'reminder'),
    allowNull: false,
    field: 'notification_type'
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'sent_at'
  }
}, {
  tableName: 'notification_logs',
  timestamps: true,
  underscored: true
});

module.exports = NotificationLog;
