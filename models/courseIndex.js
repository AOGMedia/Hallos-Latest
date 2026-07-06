const sequelize = require('../config/db');

// Import models
const Department = require('./Department');
const Course = require('./Course');
const CourseEnrollment = require('./CourseEnrollment');
const Purchase = require('./Purchase');
const User = require('./User');

// Define associations
Department.hasMany(Course, {
  foreignKey: 'departmentId',
  as: 'courses',
  onDelete: 'CASCADE'
});

Course.belongsTo(Department, {
  foreignKey: 'departmentId',
  as: 'department'
});

Course.hasMany(CourseEnrollment, {
  foreignKey: 'courseId',
  as: 'enrollments',
  onDelete: 'CASCADE'
});

CourseEnrollment.belongsTo(Course, {
  foreignKey: 'courseId',
  as: 'course'
});

CourseEnrollment.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(CourseEnrollment, {
  foreignKey: 'userId',
  as: 'courseEnrollments'
});

CourseEnrollment.belongsTo(Purchase, {
  foreignKey: 'purchaseId',
  as: 'purchase'
});

Purchase.hasOne(CourseEnrollment, {
  foreignKey: 'purchaseId',
  as: 'courseEnrollment'
});

// Admin user association for tracking who sent credentials
CourseEnrollment.belongsTo(User, {
  foreignKey: 'sentBy',
  as: 'adminUser'
});

User.hasMany(CourseEnrollment, {
  foreignKey: 'sentBy',
  as: 'processedEnrollments'
});

module.exports = {
  Department,
  Course,
  CourseEnrollment,
  Purchase,
  User,
  sequelize
};