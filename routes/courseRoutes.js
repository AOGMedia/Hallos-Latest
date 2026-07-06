const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * Course Routes
 * 
 * Public routes for course catalog browsing
 * Authenticated routes for course purchases and enrollment management
 */

/**
 * Public Course Catalog Routes
 */

// Get all departments
router.get('/departments', courseController.getDepartments);

// Get courses by department
router.get('/departments/:id/courses', courseController.getCoursesByDepartment);

// Search courses (must be before /:id route)
router.get('/search', courseController.searchCourses);

/**
 * Authenticated Course Routes
 * All routes below require authentication
 */

// Get user's course enrollments (must be before /:id route)
router.get('/my-enrollments', authMiddleware, courseController.getMyEnrollments);

// Get course details (must be after specific routes)
router.get('/:id', courseController.getCourseById);

// ✅ UPDATED: Purchase course or access pass (no :id param, accessType in body)
router.post('/purchase', authMiddleware, courseController.purchaseCourse);

module.exports = router;