const User = require('./User');
const Freebie = require('./Freebie');
const FreebieItem = require('./FreebieItem');
const FreebieDownload = require('./FreebieDownload');
const FreebieAccess = require('./FreebieAccess');

// Freebie belongs to creator
Freebie.belongsTo(User, { foreignKey: 'userId', as: 'creator' });
User.hasMany(Freebie, { foreignKey: 'userId', as: 'freebies' });

// Freebie has many items
Freebie.hasMany(FreebieItem, { foreignKey: 'freebieId', as: 'items', onDelete: 'CASCADE' });
FreebieItem.belongsTo(Freebie, { foreignKey: 'freebieId', as: 'freebie' });

// Download tracking
FreebieDownload.belongsTo(User, { foreignKey: 'userId', as: 'user' });
FreebieDownload.belongsTo(Freebie, { foreignKey: 'freebieId', as: 'freebie' });
FreebieDownload.belongsTo(FreebieItem, { foreignKey: 'freebieItemId', as: 'item' });

// FreebieAccess associations
FreebieAccess.belongsTo(User, { foreignKey: 'userId', as: 'buyer' });
FreebieAccess.belongsTo(Freebie, { foreignKey: 'freebieId', as: 'freebie' });
Freebie.hasMany(FreebieAccess, { foreignKey: 'freebieId', as: 'accessRecords', onDelete: 'CASCADE' });
User.hasMany(FreebieAccess, { foreignKey: 'userId', as: 'freebieAccess' });

module.exports = { Freebie, FreebieItem, FreebieDownload, FreebieAccess };
