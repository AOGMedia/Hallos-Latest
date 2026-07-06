'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CommunityContentSubmission = sequelize.define('CommunityContentSubmission', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  communityId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'community_id'
  },
  submittedBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'submitted_by'
  },
  contentType: {
    type: DataTypes.ENUM('live_class', 'live_series', 'video', 'freebie'),
    allowNull: false,
    field: 'content_type'
  },
  contentData: {
    type: DataTypes.JSONB,
    allowNull: false,
    field: 'content_data'
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'resubmitted'),
    allowNull: false,
    defaultValue: 'pending'
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'rejection_reason'
  },
  reviewedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'reviewed_by'
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'reviewed_at'
  },
  communityVisibility: {
    type: DataTypes.ENUM('community_only', 'public'),
    allowNull: false,
    defaultValue: 'community_only',
    field: 'community_visibility'
  }
}, {
  tableName: 'community_content_submissions',
  timestamps: true,
  underscored: true
});

module.exports = CommunityContentSubmission;

CommunityContentSubmission.associate = (models) => {
  CommunityContentSubmission.belongsTo(models.User, {
    foreignKey: 'submittedBy',
    as: 'submitter'
  });
};