const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LiveHost = sequelize.define('LiveHost', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  liveClassId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false }, // matches your User model
  role: { type: DataTypes.ENUM('creator','cohost'), defaultValue: 'cohost' }
}, {
  tableName: 'live_hosts',
  timestamps: true,
  underscored: true
});

module.exports = LiveHost;
