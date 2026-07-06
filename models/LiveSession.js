const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LiveSession = sequelize.define('LiveSession', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  seriesId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'series_id'
  },
  sessionNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'session_number'
  },
  scheduledStartTime: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'scheduled_start_time'
  },
  scheduledEndTime: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'scheduled_end_time'
  },
  actualStartTime: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'actual_start_time'
  },
  actualEndTime: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'actual_end_time'
  },
  status: {
    type: DataTypes.ENUM('scheduled', 'live', 'ended', 'cancelled'),
    allowNull: false,
    defaultValue: 'scheduled'
  },
  zegoRoomId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'zego_room_id'
  },
  zegoAppId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'zego_app_id'
  },
  recordingUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'recording_url'
  },
  reminderSent: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'reminder_sent'
  }
}, {
  tableName: 'live_sessions',
  timestamps: true,
  underscored: true
});

// Instance methods
LiveSession.prototype.isScheduled = function() {
  return this.status === 'scheduled';
};

LiveSession.prototype.isLive = function() {
  return this.status === 'live';
};

LiveSession.prototype.isEnded = function() {
  return this.status === 'ended';
};

LiveSession.prototype.isCancelled = function() {
  return this.status === 'cancelled';
};

LiveSession.prototype.canJoin = function() {
  return this.status === 'live' && this.zegoRoomId;
};

LiveSession.prototype.canStart = function() {
  return this.status === 'scheduled';
};

LiveSession.prototype.isPast = function() {
  return new Date() > new Date(this.scheduledEndTime);
};

LiveSession.prototype.isUpcoming = function() {
  return this.status === 'scheduled' && new Date() < new Date(this.scheduledStartTime);
};

LiveSession.prototype.isHappeningNow = function() {
  const now = new Date();
  return now >= new Date(this.scheduledStartTime) && now <= new Date(this.scheduledEndTime);
};

LiveSession.prototype.getDurationMinutes = function() {
  const start = new Date(this.scheduledStartTime);
  const end = new Date(this.scheduledEndTime);
  return Math.round((end - start) / (1000 * 60));
};

module.exports = LiveSession;
