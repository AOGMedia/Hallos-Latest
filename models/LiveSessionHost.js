const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Someone the creator made a co-host during one GetStream series session.
 * Scoped to that session only (live classes use live_hosts instead). Lets a
 * co-host keep the role if they rejoin, and lets in-room features (captions,
 * gifting participants) treat them as a co-host.
 *
 * New table — created by sequelize.sync on boot (and by the matching
 * migration); nothing else reads or writes it.
 */
const LiveSessionHost = sequelize.define('LiveSessionHost', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  sessionId: { type: DataTypes.UUID, allowNull: false, field: 'session_id' },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' }
}, {
  tableName: 'live_session_hosts',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['session_id', 'user_id'], name: 'live_session_hosts_session_user_unique' }]
});

module.exports = LiveSessionHost;
