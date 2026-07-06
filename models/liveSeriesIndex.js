const LiveSeries = require('./LiveSeries');
const LiveSession = require('./LiveSession');
const User = require('./User');

// Setup associations
LiveSeries.hasMany(LiveSession, {
  foreignKey: 'seriesId',
  as: 'sessions',
  onDelete: 'CASCADE'
});

LiveSession.belongsTo(LiveSeries, {
  foreignKey: 'seriesId',
  as: 'series'
});

// Creator association
LiveSeries.belongsTo(User, {
  foreignKey: 'userId',
  as: 'creator'
});

module.exports = {
  LiveSeries,
  LiveSession
};
