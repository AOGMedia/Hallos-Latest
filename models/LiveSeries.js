const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LiveSeries = sequelize.define('LiveSeries', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'NGN',
    validate: {
      isIn: [['NGN', 'USD']]
    }
  },
  thumbnailUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'thumbnail_url'
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'start_date'
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'end_date'
  },
  recurrencePattern: {
    type: DataTypes.JSON,
    allowNull: false,
    field: 'recurrence_pattern',
    comment: 'JSON object with days, startTime, duration, timezone'
  },
  status: {
    type: DataTypes.ENUM('active', 'completed', 'cancelled'),
    allowNull: false,
    defaultValue: 'active'
  },
  privacy: {
    type: DataTypes.ENUM('public', 'private'),
    allowNull: false,
    defaultValue: 'public'
  },
  maxParticipants: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 200,
    field: 'max_participants'
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
  tableName: 'live_series',
  timestamps: true,
  underscored: true
});

// Instance methods
LiveSeries.prototype.isActive = function() {
  return this.status === 'active';
};

LiveSeries.prototype.isCompleted = function() {
  return this.status === 'completed';
};

LiveSeries.prototype.isCancelled = function() {
  return this.status === 'cancelled';
};

LiveSeries.prototype.canEnroll = function() {
  return this.status === 'active' && new Date() < new Date(this.endDate);
};

LiveSeries.prototype.getFormattedPrice = function() {
  return parseFloat(this.price);
};

LiveSeries.prototype.getDurationInWeeks = function() {
  const start = new Date(this.startDate);
  const end = new Date(this.endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
};

// Currency conversion methods
LiveSeries.prototype.getDualPricing = function() {
  const CurrencyConversionService = require('../services/currencyConversionService');
  const conversionService = new CurrencyConversionService();
  return conversionService.getDualPricing(this.price, this.currency);
};

LiveSeries.prototype.getPriceInCurrency = function(targetCurrency) {
  const CurrencyConversionService = require('../services/currencyConversionService');
  const conversionService = new CurrencyConversionService();
  return conversionService.convert(this.price, this.currency, targetCurrency);
};

module.exports = LiveSeries;
