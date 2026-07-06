const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CampaignRegistration = sequelize.define('CampaignRegistration', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  firstName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'first_name'
  },
  lastName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'last_name'
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  phoneNumber: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'phone_number'
  },
  location: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  talent: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  jobDescription: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'job_description'
  },
  whatToLearn: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'what_to_learn'
  },
  paymentReference: {
    type: DataTypes.STRING(255),
    allowNull: true,
    unique: true,
    field: 'payment_reference'
  },
  paymentStatus: {
    type: DataTypes.ENUM('pending', 'completed', 'failed'),
    defaultValue: 'pending',
    field: 'payment_status'
  },
  paymentGateway: {
    type: DataTypes.STRING(20),
    defaultValue: 'paystack',
    field: 'payment_gateway'
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 3000.00
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'NGN'
  },
  emailSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'email_sent'
  }
}, {
  tableName: 'campaign_registrations',
  timestamps: true,
  underscored: true
});

module.exports = CampaignRegistration;
