const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Freebie = sequelize.define('Freebie', {
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
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    validate: { notEmpty: true, len: [1, 200] }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { notEmpty: true }
  },
  thumbnailUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'thumbnail_url'
  },
  estimatedReadingTime: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'estimated_reading_time',
    comment: 'Estimated reading time in minutes',
    validate: { min: 1 }
  },
  downloadCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    field: 'download_count'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: { min: 0 }
  },
  currency: {
    type: DataTypes.ENUM('NGN', 'USD'),
    allowNull: false,
    defaultValue: 'NGN'
  },
  communityId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'community_id'
  },
  communityVisibility: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'community_visibility'
  }
}, {
  tableName: 'freebies',
  timestamps: true,
  underscored: true
});

module.exports = Freebie;
