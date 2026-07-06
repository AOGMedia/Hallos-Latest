const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Department = sequelize.define('Department', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [1, 255]
    }
  },
  slug: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [1, 255],
      is: /^[a-z0-9-]+$/i // Only alphanumeric and hyphens
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'departments',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate: (department) => {
      // Auto-generate slug from name if not provided
      if (department.name && !department.slug) {
        department.slug = department.name
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .replace(/-+/g, '-') // Replace multiple hyphens with single
          .trim();
      }
    }
  }
});

// Instance methods
Department.prototype.getCourseCount = async function() {
  const Course = require('./Course');
  return await Course.count({
    where: { departmentId: this.id, isActive: true }
  });
};

// Class methods
Department.findBySlug = function(slug) {
  return this.findOne({ where: { slug } });
};

Department.findWithCourseCount = async function() {
  const Course = require('./Course');
  const departments = await this.findAll({
    attributes: {
      include: [
        [
          sequelize.literal(`(
            SELECT COUNT(*)
            FROM courses
            WHERE courses.department_id = "Department".id
            AND courses.is_active = true
          )`),
          'courseCount'
        ]
      ]
    },
    order: [['name', 'ASC']]
  });
  return departments;
};

module.exports = Department;