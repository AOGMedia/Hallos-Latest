const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'completed', 'cancelled'];

const EmailCampaign = sequelize.define('EmailCampaign', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false
  },
  subject: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  preheader: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  bodyHtml: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'body_html'
  },
  audience: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {}
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'draft',
    validate: { isIn: [CAMPAIGN_STATUSES] }
  },
  scheduledFor: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'scheduled_for'
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'started_at'
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'completed_at'
  },
  totalRecipients: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_recipients'
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'created_by',
    references: { model: 'Users', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  }
}, {
  tableName: 'email_campaigns',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status'], name: 'email_campaigns_status_idx' },
    { fields: ['created_at'], name: 'email_campaigns_created_at_idx' }
  ]
});

EmailCampaign.STATUSES = CAMPAIGN_STATUSES;

module.exports = EmailCampaign;
