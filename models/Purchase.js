const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Purchase = sequelize.define('Purchase', {
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
  contentType: {
    type: DataTypes.ENUM('video', 'live_class', 'live_series', 'course', 'freebie'),
    allowNull: false,
    field: 'content_type'
  },
  contentId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'content_id'
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'NGN'
  },
  paymentGateway: {
    type: DataTypes.ENUM('paystack', 'stripe'),
    allowNull: false,
    field: 'payment_gateway'
  },
  paymentReference: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: false,
    field: 'payment_reference'
  },
  paymentStatus: {
    type: DataTypes.ENUM('pending', 'completed', 'failed'),
    defaultValue: 'pending',
    field: 'payment_status'
  }
}, {
  tableName: 'purchases',
  timestamps: true,
  underscored: true
});

// Instance methods
Purchase.prototype.isCourse = function() {
  return this.contentType === 'course';
};

Purchase.prototype.isVideo = function() {
  return this.contentType === 'video';
};

Purchase.prototype.isLiveClass = function() {
  return this.contentType === 'live_class';
};

Purchase.prototype.isLiveSeries = function() {
  return this.contentType === 'live_series';
};

Purchase.prototype.getFormattedAmount = function() {
  return parseFloat(this.amount);
};

// Class methods
Purchase.findCoursesPurchases = function(options = {}) {
  return this.findAll({
    where: { 
      contentType: 'course',
      paymentStatus: 'completed'
    },
    order: [['createdAt', 'DESC']],
    ...options
  });
};

Purchase.findByUser = function(userId, contentType = null, options = {}) {
  const whereClause = { 
    userId,
    paymentStatus: 'completed'
  };
  
  if (contentType) {
    whereClause.contentType = contentType;
  }
  
  return this.findAll({
    where: whereClause,
    order: [['createdAt', 'DESC']],
    ...options
  });
};

Purchase.findByReference = function(paymentReference) {
  return this.findOne({
    where: { paymentReference }
  });
};

module.exports = Purchase;
