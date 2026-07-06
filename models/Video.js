const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Video = sequelize.define('Video', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  price: { type: DataTypes.DECIMAL(10,2), defaultValue: 0 },
  currency: { 
    type: DataTypes.STRING(3), 
    allowNull: false, 
    defaultValue: 'NGN',
    validate: {
      isIn: [['NGN', 'USD']]
    }
  },
  type: { type: DataTypes.ENUM('short','long'), defaultValue: 'short' },
  category: { type: DataTypes.STRING, allowNull: true },
  tags: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: true },
  privacy: { type: DataTypes.ENUM('public','unlisted','private'), defaultValue: 'public' },
  ageRestriction: { type: DataTypes.BOOLEAN, defaultValue: false },
  thumbnailUrl: { type: DataTypes.TEXT, allowNull: true },
  muxUploadId: { type: DataTypes.STRING, allowNull: true },
  muxAssetId: { type: DataTypes.STRING, allowNull: true },
  muxPlaybackId: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.ENUM('uploading','processing','ready','failed'), defaultValue: 'uploading' },
  durationSeconds: { type: DataTypes.INTEGER, allowNull: true },
  sizeBytes: { type: DataTypes.BIGINT, allowNull: true },
  viewsCount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
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
  tableName: 'videos',
  timestamps: true,
  underscored: true
});

// Currency conversion methods
Video.prototype.getDualPricing = function() {
  const CurrencyConversionService = require('../services/currencyConversionService');
  const conversionService = new CurrencyConversionService();
  return conversionService.getDualPricing(this.price, this.currency);
};

Video.prototype.getPriceInCurrency = function(targetCurrency) {
  const CurrencyConversionService = require('../services/currencyConversionService');
  const conversionService = new CurrencyConversionService();
  return conversionService.convert(this.price, this.currency, targetCurrency);
};

module.exports = Video;