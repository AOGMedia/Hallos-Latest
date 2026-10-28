const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LiveClass = sequelize.define('LiveClass', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' }, // Creator of the live class
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
  category: { type: DataTypes.STRING, allowNull: true },
  thumbnailUrl: { type: DataTypes.STRING, allowNull: true },
  startTime: { type: DataTypes.DATE, allowNull: true },
  endTime: { type: DataTypes.DATE, allowNull: true },

  privacy: { type: DataTypes.ENUM('public', 'private'), defaultValue: 'public' },
  status: { type: DataTypes.ENUM('scheduled','live','ended','recorded','archived'), defaultValue: 'scheduled' },

  // Mux live fields
  mux_stream_id: { type: DataTypes.STRING, allowNull: true },
  mux_stream_key: { type: DataTypes.STRING, allowNull: true },
  mux_rtmp_url: { type: DataTypes.STRING, allowNull: true },
  mux_playback_id: { type: DataTypes.STRING, allowNull: true },
  recording_asset_id: { type: DataTypes.STRING, allowNull: true },

  // ZegoCloud fields
  zego_room_id: { type: DataTypes.STRING, allowNull: true },
  zego_app_id: { type: DataTypes.STRING, allowNull: true },
  streaming_provider: {
    type: DataTypes.ENUM('mux', 'zegocloud', 'getstream'),
    defaultValue: 'zegocloud',
    validate: {
      isIn: [['mux', 'zegocloud', 'getstream']]
    }
  },
  // GetStream: id of the class's current call (`<classId>`, then `<classId>-2`
  // after an ended call is restarted). Added on boot by ensureGetStreamSupport.
  getstream_call_id: { type: DataTypes.STRING(64), allowNull: true },
  // ❌ REMOVED: zego_room_token - tokens are generated per-request
  max_participants: { 
    type: DataTypes.INTEGER, 
    allowNull: true,
    defaultValue: 50,
    validate: {
      min: 1,
      max: 1000
    }
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
  },
  // One per client form-submission session, sent on every create attempt
  // (including retries after a network failure). Lets the controller
  // detect "I already created this" and return the existing row instead
  // of inserting a duplicate. Nullable — only enforced unique where set,
  // via a partial index (see the migration), so it's safe for any caller
  // that doesn't send one.
  idempotencyKey: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'idempotency_key'
  },

}, {
  tableName: 'live_classes',
  timestamps: true,
  underscored: true,
  validate: {
    // Custom validation to ensure proper provider-specific fields
    providerFieldsConsistency() {
      if (this.streaming_provider === 'zegocloud') {
        if (this.status === 'live' && !this.zego_room_id) {
          throw new Error('ZegoCloud room ID is required for live classes using ZegoCloud');
        }
      } else if (this.streaming_provider === 'mux') {
        if (this.status === 'live' && !this.mux_stream_id) {
          throw new Error('Mux stream ID is required for live classes using Mux');
        }
      }
    }
  }
});

// Instance methods for ZegoCloud functionality
LiveClass.prototype.isZegoCloudProvider = function() {
  return this.streaming_provider === 'zegocloud';
};

LiveClass.prototype.isMuxProvider = function() {
  return this.streaming_provider === 'mux';
};

LiveClass.prototype.isGetStreamProvider = function() {
  return this.streaming_provider === 'getstream';
};

LiveClass.prototype.getStreamingConfig = function() {
  if (this.isZegoCloudProvider()) {
    return {
      provider: 'zegocloud',
      roomId: this.zego_room_id,
      appId: this.zego_app_id,
      // ❌ REMOVED: token - tokens are generated per-request for security
      maxParticipants: this.max_participants
    };
  } else if (this.isMuxProvider()) {
    return {
      provider: 'mux',
      streamId: this.mux_stream_id,
      streamKey: this.mux_stream_key,
      rtmpUrl: this.mux_rtmp_url,
      playbackId: this.mux_playback_id
    };
  }
  return null;
};

LiveClass.prototype.canAcceptMoreParticipants = function(currentCount) {
  if (!this.isZegoCloudProvider()) return true;
  return !this.max_participants || currentCount < this.max_participants;
};

// Currency conversion methods
LiveClass.prototype.getDualPricing = function() {
  const CurrencyConversionService = require('../services/currencyConversionService');
  const conversionService = new CurrencyConversionService();
  return conversionService.getDualPricing(this.price, this.currency);
};

LiveClass.prototype.getPriceInCurrency = function(targetCurrency) {
  const CurrencyConversionService = require('../services/currencyConversionService');
  const conversionService = new CurrencyConversionService();
  return conversionService.convert(this.price, this.currency, targetCurrency);
};

module.exports = LiveClass;