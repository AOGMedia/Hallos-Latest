const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizQuestion Model
 * 
 * Stores quiz questions with multiple choice options
 * Supports difficulty levels and duplicate detection
 */

const QuizQuestion = sequelize.define('QuizQuestion', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  categoryId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'category_id',
    references: {
      model: 'quiz_categories',
      key: 'id'
    }
  },
  questionText: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'question_text'
  },
  options: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: '{ a: "...", b: "...", c: "...", d: "..." }'
  },
  correctAnswer: {
    type: DataTypes.STRING(1),
    allowNull: false,
    field: 'correct_answer',
    validate: {
      isIn: [['a', 'b', 'c', 'd', 'e']]
    }
  },
  difficulty: {
    type: DataTypes.ENUM('easy', 'medium', 'hard'),
    allowNull: false,
    defaultValue: 'medium'
  },
  usageCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    field: 'usage_count'
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'created_by',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    field: 'is_active'
  }
}, {
  tableName: 'quiz_questions',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['category_id', 'difficulty']
    },
    {
      fields: ['question_text']  // Basic index for duplicate detection queries
    }
  ]
});

/**
 * Associations
 */
QuizQuestion.associate = (models) => {
  QuizQuestion.belongsTo(models.QuizCategory, {
    foreignKey: 'categoryId',
    as: 'category'
  });

  QuizQuestion.belongsTo(models.User, {
    foreignKey: 'createdBy',
    as: 'creator'
  });
};

module.exports = QuizQuestion;
