const LiveClass = require('./liveClass');
const LiveHost = require('./liveHost');
const LiveAttendee = require('./liveAttendee');
const User = require('./User');

// Setup associations
LiveClass.hasMany(LiveHost, { foreignKey: 'liveClassId', as: 'hosts' });
LiveHost.belongsTo(LiveClass, { foreignKey: 'liveClassId' });
LiveHost.belongsTo(User, { foreignKey: 'userId' });

LiveClass.hasMany(LiveAttendee, { foreignKey: 'liveClassId', as: 'attendees' });
LiveAttendee.belongsTo(LiveClass, { foreignKey: 'liveClassId' });
LiveAttendee.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// ✅ Add creator association
LiveClass.belongsTo(User, { foreignKey: 'userId', as: 'creator' });

module.exports = {
  LiveClass,
  LiveHost,
  LiveAttendee,
};
