const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * CollaborationRequest Model
 * 
 * Tracks collaboration requests sent by users to companies
 * Used for admin dashboard and rate limiting
 */

const CollaborationRequest = sequelize.define('CollaborationRequest', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  companyId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'company_id',
    references: {
      model: 'companies',
      key: 'id'
    }
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('sent', 'pending', 'responded', 'rejected'),
    allowNull: false,
    defaultValue: 'sent'
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'sent_at'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'collaboration_requests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['company_id'] },
    { fields: ['status'] },
    { fields: ['sent_at'] }
  ]
});

/**
 * Associations
 */
CollaborationRequest.associate = (models) => {
  // CollaborationRequest belongs to a user
  CollaborationRequest.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user'
  });

  // CollaborationRequest belongs to a company
  CollaborationRequest.belongsTo(models.Company, {
    foreignKey: 'companyId',
    as: 'company'
  });
};

module.exports = CollaborationRequest;
