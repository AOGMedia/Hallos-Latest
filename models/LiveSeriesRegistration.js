'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LiveSeriesRegistration = sequelize.define('LiveSeriesRegistration', {
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
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  }
}, {
  tableName: 'live_series_registrations',
  timestamps: true,
  underscored: true
});

// Associations
LiveSeriesRegistration.belongsTo(require('./User'), { foreignKey: 'userId', as: 'user' });

module.exports = LiveSeriesRegistration;
