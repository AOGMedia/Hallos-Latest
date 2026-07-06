/**
 * Feedback Models Index
 * 
 * Sets up associations between Feedback and User models
 */

const Feedback = require('./Feedback');
const User = require('./User');

// Set up associations
Feedback.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

Feedback.belongsTo(User, {
  foreignKey: 'reviewedBy',
  as: 'reviewer'
});

User.hasMany(Feedback, {
  foreignKey: 'userId',
  as: 'feedbacks'  // Changed from 'feedbackSubmitted' to avoid collision
});

User.hasMany(Feedback, {
  foreignKey: 'reviewedBy',
  as: 'reviewedFeedbacks'  // Changed from 'feedbackReviewed'
});

module.exports = {
  Feedback
};
