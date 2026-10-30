const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const EmailCampaign = require('./EmailCampaign');

const RECIPIENT_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'];

const EmailCampaignRecipient = sequelize.define('EmailCampaignRecipient', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'campaign_id',
    references: { model: 'email_campaigns', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'user_id',
    references: { model: 'Users', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  firstName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'first_name'
  },
  lastName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'last_name'
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pending',
    validate: { isIn: [RECIPIENT_STATUSES] }
  },
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  error: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  messageId: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'message_id'
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'sent_at'
  }
}, {
  tableName: 'email_campaign_recipients',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['campaign_id', 'status'], name: 'email_campaign_recipients_campaign_status_idx' },
    { fields: ['campaign_id', 'email'], unique: true, name: 'email_campaign_recipients_campaign_email_unique' },
    { fields: ['status', 'sent_at'], name: 'email_campaign_recipients_status_sent_at_idx' },
    { fields: ['user_id'], name: 'email_campaign_recipients_user_idx' }
  ]
});

EmailCampaign.hasMany(EmailCampaignRecipient, { foreignKey: 'campaignId', as: 'recipients' });
EmailCampaignRecipient.belongsTo(EmailCampaign, { foreignKey: 'campaignId', as: 'campaign' });

EmailCampaignRecipient.STATUSES = RECIPIENT_STATUSES;

module.exports = EmailCampaignRecipient;
