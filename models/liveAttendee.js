const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LiveAttendee = sequelize.define('LiveAttendee', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  liveClassId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  invitedBy: { type: DataTypes.INTEGER, allowNull: true },
  statusPaid: { type: DataTypes.BOOLEAN, defaultValue: false }
}, {
  tableName: 'live_attendees',
  timestamps: true,
  underscored: true
});

module.exports = LiveAttendee;
