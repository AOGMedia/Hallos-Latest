const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Feedback Model
 * 
 * Stores user feedback for the platform
 * Allows creators, educators, and learners to share their experience
 * Admins can view, review, and manage feedback
 */

const Feedback = sequelize.define('Feedback', {
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
  userType: {
    type: DataTypes.ENUM('creator', 'learner', 'educator'),
    allowNull: false,
    field: 'user_type',
    comment: 'Type of user submitting feedback'
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    },
    comment: 'Rating from 1 to 5 stars'
  },
  category: {
    type: DataTypes.ENUM('bug', 'feature_request', 'improvement', 'general', 'complaint', 'praise'),
    allowNull: false,
    defaultValue: 'general',
    comment: 'Category of feedback'
  },
  subject: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Brief subject/title of feedback'
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Detailed feedback message'
  },
  status: {
    type: DataTypes.ENUM('new', 'reviewed', 'in_progress', 'resolved', 'dismissed'),
    allowNull: false,
    defaultValue: 'new',
    comment: 'Status of feedback for admin tracking'
  },
  adminNotes: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'admin_notes',
    comment: 'Internal notes from admin'
  },
  reviewedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'reviewed_by',
    references: {
      model: 'Users',
      key: 'id'
    },
    comment: 'Admin user who reviewed this feedback'
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'reviewed_at',
    comment: 'When feedback was reviewed'
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
  tableName: 'feedback',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['rating'] },
    { fields: ['user_type'] },
    { fields: ['category'] },
    { fields: ['created_at'] }
  ]
});

/**
 * Associations
 */
Feedback.associate = (models) => {
  // Feedback belongs to a user (submitter)
  Feedback.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user'
  });

  // Feedback can be reviewed by an admin
  Feedback.belongsTo(models.User, {
    foreignKey: 'reviewedBy',
    as: 'reviewer'
  });
};

module.exports = Feedback;
