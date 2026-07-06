'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DigestQueue = sequelize.define('DigestQueue', {
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
  digestType: {
    type: DataTypes.ENUM('daily', 'weekly'),
    allowNull: false,
    field: 'digest_type'
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'skipped'),
    allowNull: false,
    defaultValue: 'pending'
  }
}, {
  tableName: 'digest_queue',
  timestamps: true,
  underscored: true
});

module.exports = DigestQueue;
