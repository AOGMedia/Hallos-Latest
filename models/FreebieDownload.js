const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FreebieDownload = sequelize.define('FreebieDownload', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
    references: { model: 'Users', key: 'id' }
  },
  freebieId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'freebie_id',
    references: { model: 'freebies', key: 'id' }
  },
  freebieItemId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'freebie_item_id',
    references: { model: 'freebie_items', key: 'id' }
  }
}, {
  tableName: 'freebie_downloads',
  timestamps: true,
  underscored: true,
  updatedAt: false
});

module.exports = FreebieDownload;
