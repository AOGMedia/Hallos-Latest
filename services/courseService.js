const { Op } = require('sequelize');

// Import models with associations
require('../models/courseIndex');
const Department = require('../models/Department');
const Course = require('../models/Course');
const CourseEnrollment = require('../models/CourseEnrollment');

/**
 * Course Service
 * 
 * Handles all course-related business logic:
 * - Department and course retrieval
 * - Course search and filtering
 * - Course validation
 * - Performance optimization with caching
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.5, 10.1, 10.2
 */

class CourseService {
  constructor() {
    // Configuration
    this.config = {
      // Default pagination
      pagination: {
        defaultLimit: 20,
        maxLimit: 100
      },
      
      // Cache settings (in-memory for now, can be extended to Redis)
      cache: {
        enabled: process.env.NODE_ENV === 'production',
        ttl: 5 * 60 * 1000 // 5 minutes
      }
    };

    // Simple in-memory cache
    this.cache = new Map();
  }

  /**
   * Get all departments with course counts
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of departments with course counts
   */
  async getAllDepartments(options = {}) {
    try {
      const cacheKey = 'departments_with_counts';
      
      // Check cache
      if (this.config.cache.enabled && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.config.cache.ttl) {
          console.log('[Course Service] Returning cached departments');
          return cached.data;
        }
      }

      console.log('[Course Service] Fetching departments from database');

      const departments = await Department.findAll({
        attributes: {
          include: [
            [
              Department.sequelize.literal(`(
                SELECT COUNT(*)
                FROM courses
                WHERE courses.department_id = "Department".id
                AND courses.is_active = true
              )`),
              'courseCount'
            ]
          ]
        },
        order: [['name', 'ASC']],
        ...options
      });

      // Parse course counts as integers
      const departmentsWithCounts = departments.map(dept => {
        const deptData = dept.toJSON();
        deptData.courseCount = parseInt(deptData.courseCount) || 0;
        return deptData;
      });

      // Cache result
      if (this.config.cache.enabled) {
        this.cache.set(cacheKey, {
          data: departmentsWithCounts,
          timestamp: Date.now()
        });
      }

      return departmentsWithCounts;
    } catch (error) {
      console.error('[Course Service] Get departments error:', error);
      throw error;
    }
  }

  /**
   * Get department by ID or slug
   * @param {string} identifier - Department ID or slug
   * @returns {Promise<Object|null>} Department object or null
   */
  async getDepartmentById(identifier) {
    try {
      console.log(`[Course Service] Getting department: ${identifier}`);

      // Try to find by ID first, then by slug
      let department = await Department.findByPk(identifier);
      
      if (!department) {
        department = await Department.findOne({
          where: { slug: identifier }
        });
      }

      if (!department) {
        return null;
      }

      // Add course count
      const courseCount = await Course.count({
        where: { 
          departmentId: department.id,
          isActive: true 
        }
      });

      const departmentData = department.toJSON();
      departmentData.courseCount = courseCount;

      return departmentData;
    } catch (error) {
      console.error('[Course Service] Get department error:', error);
      throw error;
    }
  }

  /**
   * Get courses by department
   * @param {Object} params - Parameters object
   * @param {string} params.departmentId - Department ID or slug
   * @param {number} params.limit - Limit for pagination
   * @param {number} params.offset - Offset for pagination
   * @param {string} params.search - Search query
   * @param {boolean} params.includeInactive - Include inactive courses
   * @returns {Promise<Object>} Paginated courses with metadata
   */
  async getCoursesByDepartment(params = {}) {
    try {
      const {
        departmentId,
        limit = this.config.pagination.defaultLimit,
        offset = 0,
        search = null,
        includeInactive = false
      } = params;

      console.log(`[Course Service] Getting courses for department: ${departmentId}`);

      // Find department first
      const department = await this.getDepartmentById(departmentId);
      if (!department) {
        throw new Error('Department not found');
      }

      // Build where clause
      const whereClause = {
        departmentId: department.id
      };

      if (!includeInactive) {
        whereClause.isActive = true;
      }

      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { content: { [Op.iLike]: `%${search}%` } },
          { curriculum: { [Op.iLike]: `%${search}%` } }
        ];
      }

      // Get total count
      const totalCount = await Course.count({ where: whereClause });

      // Get courses
      const courses = await Course.findAll({
        where: whereClause,
        include: [{
          model: Department,
          as: 'department',
          attributes: ['id', 'name', 'slug']
        }],
        order: [['name', 'ASC']],
        limit: Math.min(parseInt(limit), this.config.pagination.maxLimit),
        offset: parseInt(offset)
      });

      // Add enrollment counts
      const coursesWithEnrollments = await Promise.all(
        courses.map(async (course) => {
          const courseData = course.toJSON();
          courseData.enrollmentCount = await CourseEnrollment.count({
            where: { courseId: course.id }
          });
          return courseData;
        })
      );

      return {
        success: true,
        department,
        courses: coursesWithEnrollments,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          pages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: Math.floor(parseInt(offset) / parseInt(limit)) + 1
        },
        filters: {
          search,
          includeInactive
        }
      };
    } catch (error) {
      console.error('[Course Service] Get courses by department error:', error);
      throw error;
    }
  }

  /**
   * Get course by ID
   * @param {string} courseId - Course ID
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} Course object with full details
   */
  async getCourseById(courseId, options = {}) {
    try {
      const { includeInactive = false } = options;

      console.log(`[Course Service] Getting course: ${courseId}`);

      const whereClause = { id: courseId };
      if (!includeInactive) {
        whereClause.isActive = true;
      }

      const course = await Course.findOne({
        where: whereClause,
        include: [{
          model: Department,
          as: 'department',
          attributes: ['id', 'name', 'slug', 'description']
        }]
      });

      if (!course) {
        return null;
      }

      // Add enrollment statistics
      const enrollmentCount = await CourseEnrollment.count({
        where: { courseId: course.id }
      });

      const courseData = course.toJSON();
      courseData.enrollmentCount = enrollmentCount;

      return courseData;
    } catch (error) {
      console.error('[Course Service] Get course error:', error);
      throw error;
    }
  }

  /**
   * Search courses across all departments
   * @param {Object} params - Search parameters
   * @param {string} params.query - Search query
   * @param {string} params.departmentId - Optional department filter
   * @param {number} params.limit - Limit for pagination
   * @param {number} params.offset - Offset for pagination
   * @returns {Promise<Object>} Search results with pagination
   */
  async searchCourses(params = {}) {
    try {
      const {
        query,
        departmentId = null,
        limit = this.config.pagination.defaultLimit,
        offset = 0,
        includeInactive = false
      } = params;

      console.log(`[Course Service] Searching courses: "${query}"`);

      if (!query || query.trim().length === 0) {
        throw new Error('Search query is required');
      }

      // Build where clause
      const whereClause = {
        [Op.or]: [
          { name: { [Op.iLike]: `%${query}%` } },
          { content: { [Op.iLike]: `%${query}%` } },
          { curriculum: { [Op.iLike]: `%${query}%` } }
        ]
      };

      if (!includeInactive) {
        whereClause.isActive = true;
      }

      if (departmentId) {
        whereClause.departmentId = departmentId;
      }

      // Get total count
      const totalCount = await Course.count({ where: whereClause });

      // Get courses
      const courses = await Course.findAll({
        where: whereClause,
        include: [{
          model: Department,
          as: 'department',
          attributes: ['id', 'name', 'slug']
        }],
        order: [['name', 'ASC']],
        limit: Math.min(parseInt(limit), this.config.pagination.maxLimit),
        offset: parseInt(offset)
      });

      // Add enrollment counts
      const coursesWithEnrollments = await Promise.all(
        courses.map(async (course) => {
          const courseData = course.toJSON();
          courseData.enrollmentCount = await CourseEnrollment.count({
            where: { courseId: course.id }
          });
          return courseData;
        })
      );

      return {
        success: true,
        query,
        courses: coursesWithEnrollments,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          pages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: Math.floor(parseInt(offset) / parseInt(limit)) + 1
        },
        filters: {
          departmentId,
          includeInactive
        }
      };
    } catch (error) {
      console.error('[Course Service] Search courses error:', error);
      throw error;
    }
  }

  /**
   * Get featured or popular courses
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of featured courses
   */
  async getFeaturedCourses(options = {}) {
    try {
      const { limit = 10 } = options;

      console.log('[Course Service] Getting featured courses');

      // Get courses with highest enrollment counts
      const courses = await Course.findAll({
        where: { isActive: true },
        include: [
          {
            model: Department,
            as: 'department',
            attributes: ['id', 'name', 'slug']
          },
          {
            model: CourseEnrollment,
            as: 'enrollments',
            attributes: []
          }
        ],
        attributes: {
          include: [
            [
              Course.sequelize.fn('COUNT', Course.sequelize.col('enrollments.id')),
              'enrollmentCount'
            ]
          ]
        },
        group: ['Course.id', 'department.id'],
        order: [
          [Course.sequelize.literal('enrollmentCount'), 'DESC'],
          ['name', 'ASC']
        ],
        limit: parseInt(limit)
      });

      return courses.map(course => {
        const courseData = course.toJSON();
        courseData.enrollmentCount = parseInt(courseData.enrollmentCount) || 0;
        return courseData;
      });
    } catch (error) {
      console.error('[Course Service] Get featured courses error:', error);
      throw error;
    }
  }

  /**
   * Get course statistics
   * @returns {Promise<Object>} Course statistics
   */
  async getCourseStatistics() {
    try {
      console.log('[Course Service] Getting course statistics');

      const [
        totalCourses,
        activeCourses,
        totalDepartments,
        totalEnrollments
      ] = await Promise.all([
        Course.count(),
        Course.count({ where: { isActive: true } }),
        Department.count(),
        CourseEnrollment.count()
      ]);

      return {
        courses: {
          total: totalCourses,
          active: activeCourses,
          inactive: totalCourses - activeCourses
        },
        departments: totalDepartments,
        enrollments: totalEnrollments,
        averageCoursesPerDepartment: totalDepartments > 0 ? (activeCourses / totalDepartments).toFixed(2) : 0
      };
    } catch (error) {
      console.error('[Course Service] Get statistics error:', error);
      throw error;
    }
  }

  /**
   * Validate course data
   * @param {Object} courseData - Course data to validate
   * @returns {Object} Validation result
   */
  validateCourseData(courseData) {
    const errors = [];

    // Required fields
    if (!courseData.name || courseData.name.trim().length === 0) {
      errors.push('Course name is required');
    }

    if (!courseData.link || courseData.link.trim().length === 0) {
      errors.push('Course link is required');
    }

    if (!courseData.departmentId) {
      errors.push('Department ID is required');
    }

    // Validate URL
    if (courseData.link) {
      try {
        new URL(courseData.link);
      } catch {
        errors.push('Course link must be a valid URL');
      }
    }

    // Validate name length
    if (courseData.name && courseData.name.length > 255) {
      errors.push('Course name must be less than 255 characters');
    }

    // Validate duration format
    if (courseData.duration && courseData.duration.length > 100) {
      errors.push('Duration must be less than 100 characters');
    }

    // Validate image URL if provided
    if (courseData.imageUrl) {
      try {
        new URL(courseData.imageUrl);
      } catch {
        errors.push('Image URL must be a valid URL');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Clear cache (useful for testing or manual cache invalidation)
   */
  clearCache() {
    this.cache.clear();
    console.log('[Course Service] Cache cleared');
  }

  /**
   * Get service configuration
   * @returns {Object} Service configuration
   */
  getConfiguration() {
    return {
      pagination: this.config.pagination,
      cache: this.config.cache
    };
  }
}

module.exports = CourseService;