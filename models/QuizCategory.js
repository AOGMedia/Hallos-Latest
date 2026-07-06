const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizCategory Model
 * 
 * Stores quiz question categories
 * Each category can have multiple questions
 */

const QuizCategory = sequelize.define('QuizCategory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  questionCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    field: 'question_count'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    field: 'is_active'
  }
}, {
  tableName: 'quiz_categories',
  timestamps: true,
  underscored: true
});

/**
 * Associations
 */
QuizCategory.associate = (models) => {
  QuizCategory.hasMany(models.QuizQuestion, {
    foreignKey: 'categoryId',
    as: 'questions'
  });
};

module.exports = QuizCategory;
