/**
 * UGC Agency Models Index
 * 
 * Sets up associations between Company and CollaborationRequest models
 */

const Company = require('./Company');
const CollaborationRequest = require('./CollaborationRequest');
const User = require('./User');

// Set up associations
Company.hasMany(CollaborationRequest, {
  foreignKey: 'companyId',
  as: 'collaborationRequests'
});

CollaborationRequest.belongsTo(Company, {
  foreignKey: 'companyId',
  as: 'company'
});

CollaborationRequest.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(CollaborationRequest, {
  foreignKey: 'userId',
  as: 'collaborationRequests'
});

module.exports = {
  Company,
  CollaborationRequest
};
