const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const SessionRecordingSend = sequelize.define('SessionRecordingSend', {
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
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  driveLink: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'drive_link'
  },
  sendBatchId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'send_batch_id'
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'sent_at'
  }
}, {
  tableName: 'session_recording_sends',
  timestamps: true,
  underscored: true
});

module.exports = SessionRecordingSend;
