const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Course = sequelize.define('Course', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  departmentId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'department_id',
    validate: {
      notEmpty: true
    }
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 255]
    }
  },
  link: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true,
      isUrl: true
    }
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  curriculum: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  duration: {
    type: DataTypes.STRING(100),
    allowNull: true,
    validate: {
      len: [0, 100]
    }
  },
  imageUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'image_url',
    validate: {
      isUrl: {
        msg: 'Image URL must be a valid URL'
      }
    }
  },
  // ✅ REMOVED: priceUsd and priceNgn fields
  // Pricing is now managed by CoursePricingService via .env configuration
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },
}, {
  tableName: 'courses',
  timestamps: true,
  underscored: true,
  // ✅ REMOVED: Price enforcement hooks (pricing now in service layer)
  scopes: {
    active: {
      where: { isActive: true }
    },
    withDepartment: {
      include: [{
        model: sequelize.models.Department,
        as: 'department'
      }]
    }
  }
});

// Instance methods
// ✅ REMOVED: getPrice() method - Use CoursePricingService instead

Course.prototype.getEnrollmentCount = async function() {
  const CourseEnrollment = require('./CourseEnrollment');
  return await CourseEnrollment.count({
    where: { courseId: this.id }
  });
};

Course.prototype.toJSON = function() {
  const values = Object.assign({}, this.get());
  // No price conversion needed - prices removed from model
  return values;
};

// Class methods
Course.findByDepartment = function(departmentId, options = {}) {
  return this.findAll({
    where: { 
      departmentId, 
      isActive: true 
    },
    order: [['name', 'ASC']],
    ...options
  });
};

Course.findActiveWithDepartment = function(options = {}) {
  return this.scope(['active', 'withDepartment']).findAll({
    order: [['name', 'ASC']],
    ...options
  });
};

Course.searchCourses = function(query, departmentId = null, options = {}) {
  const whereClause = {
    isActive: true,
    [sequelize.Op.or]: [
      { name: { [sequelize.Op.iLike]: `%${query}%` } },
      { content: { [sequelize.Op.iLike]: `%${query}%` } },
      { curriculum: { [sequelize.Op.iLike]: `%${query}%` } }
    ]
  };

  if (departmentId) {
    whereClause.departmentId = departmentId;
  }

  return this.findAll({
    where: whereClause,
    include: [{
      model: sequelize.models.Department,
      as: 'department'
    }],
    order: [['name', 'ASC']],
    ...options
  });
};

module.exports = Course;