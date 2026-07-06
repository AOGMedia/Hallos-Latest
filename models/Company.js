const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Company Model
 * 
 * Stores Nigerian brands/companies for UGC creator collaborations
 * Seeded from Excel file
 */

const Company = sequelize.define('Company', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  companyName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    field: 'company_name'
  },
  industry: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  website: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  contactName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'contact_name'
  },
  contactEmail: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'contact_email'
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
  tableName: 'companies',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['industry'] },
    { fields: ['company_name'] }
  ]
});

/**
 * Associations
 */
Company.associate = (models) => {
  // Company has many collaboration requests
  Company.hasMany(models.CollaborationRequest, {
    foreignKey: 'companyId',
    as: 'collaborationRequests'
  });
};

module.exports = Company;
