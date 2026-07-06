const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const VideoView = sequelize.define('VideoView', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  videoId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true, // null for guests
  },
  ipAddress: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  watchDuration: {
    type: DataTypes.INTEGER, // in seconds
    allowNull: true,
  },
  lastWatchedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'video_views',
  timestamps: true,
  underscored: true,
});

module.exports = VideoView;