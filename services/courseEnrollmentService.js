const { Op } = require('sequelize');
const sequelize = require('../config/db');

// Import models with associations
require('../models/courseIndex');
const CourseEnrollment = require('../models/CourseEnrollment');
const Course = require('../models/Course');
const Department = require('../models/Department');
const Purchase = require('../models/Purchase');
const User = require('../models/User');

/**
 * Course Enrollment Service
 * 
 * Handles all course enrollment-related business logic:
 * - Enrollment creation with student details
 * - Admin dashboard enrollment management
 * - Credentials sent toggle functionality
 * - Student data management and validation
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 9.3
 */

class CourseEnrollmentService {
  constructor() {
    // Configuration
    this.config = {
      // Default pagination
      pagination: {
        defaultLimit: 20,
        maxLimit: 100
      },
      
      // Validation rules
      validation: {
        studentName: {
          minLength: 1,
          maxLength: 255
        },
        studentEmail: {
          maxLength: 255
        },
        studentPhone: {
          minLength: 1,
          maxLength: 50
        }
      }
    };
  }

  /**
   * Create enrollment after successful payment
   * @param {Object} enrollmentData - Enrollment data
   * @returns {Promise<Object>} Created enrollment
   */
  async createEnrollment(enrollmentData) {
    const transaction = await sequelize.transaction();
    
    try {
      const {
        userId,
        courseId,  // ✅ Can be null for monthly/yearly
        purchaseId,
        studentName,
        studentEmail,
        studentPhone,
        accessType = 'individual',  // ✅ NEW
        expiresAt = null  // ✅ NEW
      } = enrollmentData;

      console.log(`[Enrollment Service] Creating enrollment - User: ${userId}, Access: ${accessType}, Course: ${courseId || 'All Courses'}`);

      // Validate required fields
      const validation = this.validateStudentDetails({
        studentName,
        studentEmail,
        studentPhone
      });

      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // ✅ NEW: Validate accessType
      if (!['individual', 'monthly', 'yearly'].includes(accessType)) {
        throw new Error(`Invalid access type: ${accessType}`);
      }

      // ✅ NEW: For individual, courseId is required
      if (accessType === 'individual' && !courseId) {
        throw new Error('Course ID is required for individual access type');
      }

      // ✅ NEW: For monthly/yearly, courseId should be null
      if (['monthly', 'yearly'].includes(accessType) && courseId) {
        throw new Error('Course ID should not be provided for monthly/yearly access');
      }

      // Check if enrollment already exists
      const whereClause = { userId, purchaseId };
      if (courseId) {
        whereClause.courseId = courseId;
      }

      const existingEnrollment = await CourseEnrollment.findOne({
        where: whereClause,
        transaction
      });

      if (existingEnrollment) {
        await transaction.rollback();
        throw new Error('Enrollment already exists for this purchase');
      }

      // Verify course exists and is active (only for individual purchases)
      if (accessType === 'individual') {
        const course = await Course.findOne({
          where: { id: courseId, isActive: true },
          transaction
        });

        if (!course) {
          await transaction.rollback();
          throw new Error('Course not found or inactive');
        }
      }

      // Verify purchase exists and is completed
      const purchase = await Purchase.findOne({
        where: { 
          id: purchaseId,
          userId,
          contentType: 'course',
          paymentStatus: 'completed'
        },
        transaction
      });

      if (!purchase) {
        await transaction.rollback();
        throw new Error('Valid purchase not found for this course');
      }

      // Create enrollment
      const enrollment = await CourseEnrollment.create({
        userId,
        courseId,  // ✅ null for monthly/yearly
        purchaseId,
        studentName: studentName.trim(),
        studentEmail: studentEmail.trim().toLowerCase(),
        studentPhone: studentPhone.trim(),
        accessType,  // ✅ NEW
        expiresAt,  // ✅ NEW
        credentialsSent: false
      }, { transaction });

      await transaction.commit();

      console.log(`[Enrollment Service] Enrollment created - ID: ${enrollment.id}, Access: ${accessType}, Expires: ${expiresAt || 'Never'}`);

      // Return enrollment with related data
      return await this.getEnrollmentDetails(enrollment.id);

    } catch (error) {
      await transaction.rollback();
      console.error('[Enrollment Service] Create enrollment error:', error);
      throw error;
    }
  }

  /**
   * Get enrollments for admin dashboard
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated enrollments
   * 
   * ✅ UPDATED: Now supports accessType and expiryStatus filters
   */
  async getEnrollmentsForAdmin(options = {}) {
    try {
      const {
        status = 'all', // 'pending', 'completed', 'all'
        limit = this.config.pagination.defaultLimit,
        offset = 0,
        search = null,
        departmentId = null,
        courseId = null,
        credentialsSent = null,
        accessType = null,  // ✅ NEW: 'individual', 'monthly', 'yearly'
        expiryStatus = null,  // ✅ NEW: 'active', 'expired', 'expiring_soon'
        sortBy = 'createdAt',
        sortOrder = 'DESC'
      } = options;

      console.log(`[Enrollment Service] Getting enrollments for admin - status: ${status}, accessType: ${accessType}, expiryStatus: ${expiryStatus}`);

      // Build where clause
      const whereClause = {};

      if (status === 'pending') {
        whereClause.credentialsSent = false;
      } else if (status === 'completed') {
        whereClause.credentialsSent = true;
      }

      if (credentialsSent !== null) {
        whereClause.credentialsSent = credentialsSent;
      }

      // ✅ NEW: Filter by access type
      if (accessType) {
        whereClause.accessType = accessType;
      }

      // ✅ NEW: Filter by expiry status
      if (expiryStatus) {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        if (expiryStatus === 'expired') {
          // Show only expired (expiresAt < now)
          whereClause.expiresAt = {
            [Op.not]: null,
            [Op.lt]: now
          };
        } else if (expiryStatus === 'active') {
          // Show only active (expiresAt > now OR expiresAt IS NULL)
          whereClause[Op.or] = [
            { expiresAt: null },
            { expiresAt: { [Op.gt]: now } }
          ];
        } else if (expiryStatus === 'expiring_soon') {
          // Show expiring within 7 days
          whereClause.expiresAt = {
            [Op.between]: [now, sevenDaysFromNow]
          };
        }
      }

      // Build include clause for search and filtering
      const includeClause = [
        {
          model: Course,
          as: 'course',
          required: false,  // ✅ Allow null for monthly/yearly
          include: [{
            model: Department,
            as: 'department',
            attributes: ['id', 'name', 'slug']
          }],
          where: departmentId ? { departmentId } : {}
        },
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        },
        {
          model: Purchase,
          as: 'purchase',
          attributes: ['id', 'amount', 'currency', 'paymentGateway', 'paymentReference', 'createdAt']
        }
      ];

      // Add admin user if credentials sent
      if (status === 'completed' || status === 'all') {
        includeClause.push({
          model: User,
          as: 'adminUser',
          attributes: ['id', 'firstname', 'lastname', 'email'],
          required: false
        });
      }

      // Add search functionality
      if (search) {
        whereClause[Op.or] = [
          { studentName: { [Op.iLike]: `%${search}%` } },
          { studentEmail: { [Op.iLike]: `%${search}%` } },
          { studentPhone: { [Op.iLike]: `%${search}%` } }
        ];
      }

      // Filter by specific course (for individual purchases)
      if (courseId) {
        whereClause.courseId = courseId;
      }

      // Validate sort parameters
      const validSortFields = ['createdAt', 'studentName', 'studentEmail', 'sentAt', 'expiresAt'];
      const validSortOrders = ['ASC', 'DESC'];
      
      const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const safeSortOrder = validSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

      // Get total count
      const totalCount = await CourseEnrollment.count({
        where: whereClause,
        include: includeClause.filter(inc => inc.model === Course) // Only include course for counting
      });

      // Get enrollments
      const enrollments = await CourseEnrollment.findAll({
        where: whereClause,
        include: includeClause,
        order: [[safeSortBy, safeSortOrder]],
        limit: Math.min(parseInt(limit), this.config.pagination.maxLimit),
        offset: parseInt(offset)
      });

      // ✅ NEW: Calculate summary statistics
      const summary = await this.calculateEnrollmentSummary(whereClause, includeClause);

      return {
        success: true,
        enrollments: enrollments.map(enrollment => enrollment.toJSON()),
        summary,  // ✅ NEW
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          pages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: Math.floor(parseInt(offset) / parseInt(limit)) + 1
        },
        filters: {
          status,
          search,
          departmentId,
          courseId,
          credentialsSent,
          accessType,  // ✅ NEW
          expiryStatus,  // ✅ NEW
          sortBy: safeSortBy,
          sortOrder: safeSortOrder
        }
      };
    } catch (error) {
      console.error('[Enrollment Service] Get enrollments for admin error:', error);
      throw error;
    }
  }

  /**
   * Get enrollment details by ID
   * @param {string} enrollmentId - Enrollment ID
   * @returns {Promise<Object|null>} Enrollment details
   */
  async getEnrollmentDetails(enrollmentId) {
    try {
      console.log(`[Enrollment Service] Getting enrollment details: ${enrollmentId}`);

      const enrollment = await CourseEnrollment.findByPk(enrollmentId, {
        include: [
          {
            model: Course,
            as: 'course',
            include: [{
              model: Department,
              as: 'department'
            }]
          },
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstname', 'lastname', 'email']
          },
          {
            model: Purchase,
            as: 'purchase'
          },
          {
            model: User,
            as: 'adminUser',
            attributes: ['id', 'firstname', 'lastname', 'email'],
            required: false
          }
        ]
      });

      if (!enrollment) {
        return null;
      }

      return enrollment.toJSON();
    } catch (error) {
      console.error('[Enrollment Service] Get enrollment details error:', error);
      throw error;
    }
  }

  /**
   * Toggle credentials sent status
   * @param {string} enrollmentId - Enrollment ID
   * @param {number} adminId - Admin user ID
   * @param {boolean} credentialsSent - New credentials sent status
   * @returns {Promise<Object>} Updated enrollment
   */
  async toggleCredentialsSent(enrollmentId, adminId, credentialsSent = true) {
    const transaction = await sequelize.transaction();
    
    try {
      console.log(`[Enrollment Service] Toggling credentials sent for enrollment ${enrollmentId} by admin ${adminId}`);

      // Find enrollment
      const enrollment = await CourseEnrollment.findByPk(enrollmentId, { transaction });

      if (!enrollment) {
        await transaction.rollback();
        throw new Error('Enrollment not found');
      }

      // Verify admin user exists
      const adminUser = await User.findByPk(adminId, { transaction });
      if (!adminUser) {
        await transaction.rollback();
        throw new Error('Admin user not found');
      }

      // Update enrollment
      if (credentialsSent) {
        await enrollment.markCredentialsSent(adminId);
      } else {
        await enrollment.markCredentialsNotSent();
      }

      await transaction.commit();

      console.log(`[Enrollment Service] Credentials sent status updated to: ${credentialsSent}`);

      // Return updated enrollment with details
      return await this.getEnrollmentDetails(enrollmentId);

    } catch (error) {
      await transaction.rollback();
      console.error('[Enrollment Service] Toggle credentials sent error:', error);
      throw error;
    }
  }

  /**
   * Mark credentials sent (wrapper for controller)
   * @param {Object} options - Options object
   * @returns {Promise<Object>} Updated enrollment
   */
  async markCredentialsSent(options) {
    const { enrollmentId, sent, adminId, notes } = options;
    
    const transaction = await sequelize.transaction();
    
    try {
      console.log(`[Enrollment Service] Marking credentials ${sent ? 'sent' : 'not sent'} for enrollment ${enrollmentId}`);

      // Find enrollment
      const enrollment = await CourseEnrollment.findByPk(enrollmentId, { transaction });

      if (!enrollment) {
        await transaction.rollback();
        throw new Error('Enrollment not found');
      }

      const previousStatus = enrollment.credentialsSent;

      // Update enrollment
      if (sent) {
        await enrollment.markCredentialsSent(adminId);
      } else {
        await enrollment.markCredentialsNotSent();
      }

      await enrollment.save({ transaction });
      await transaction.commit();

      console.log(`[Enrollment Service] Credentials status updated from ${previousStatus} to ${sent}`);

      // Return updated enrollment with details
      const updatedEnrollment = await this.getEnrollmentDetails(enrollmentId);

      return {
        enrollment: updatedEnrollment,
        previousStatus
      };

    } catch (error) {
      await transaction.rollback();
      console.error('[Enrollment Service] Mark credentials sent error:', error);
      throw error;
    }
  }

  /**
   * Batch mark credentials sent
   * @param {Object} options - Options object
   * @returns {Promise<Object>} Batch operation results
   */
  async batchMarkCredentialsSent(options) {
    const { enrollmentIds, sent, adminId, notes } = options;
    
    try {
      console.log(`[Enrollment Service] Batch marking credentials ${sent ? 'sent' : 'not sent'} for ${enrollmentIds.length} enrollments`);

      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };

      // Process each enrollment
      for (const enrollmentId of enrollmentIds) {
        try {
          await this.markCredentialsSent({
            enrollmentId,
            sent,
            adminId,
            notes
          });
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            enrollmentId,
            error: error.message
          });
          console.error(`[Enrollment Service] Failed to update enrollment ${enrollmentId}:`, error.message);
        }
      }

      console.log(`[Enrollment Service] Batch update complete: ${results.successful} successful, ${results.failed} failed`);

      return results;

    } catch (error) {
      console.error('[Enrollment Service] Batch mark credentials sent error:', error);
      throw error;
    }
  }

  /**
   * Export enrollments to CSV or JSON
   * @param {Object} filters - Filter options
   * @param {string} format - Export format ('csv' or 'json')
   * @returns {Promise<Object>} Export data
   */
  async exportEnrollments(filters = {}, format = 'csv') {
    try {
      console.log(`[Enrollment Service] Exporting enrollments as ${format}`);

      const {
        credentialsSent,
        courseId,
        departmentId,
        startDate,
        endDate,
        accessType,
        expiryStatus
      } = filters;

      // Build where clause
      const whereClause = {};

      if (credentialsSent !== undefined) {
        whereClause.credentialsSent = credentialsSent;
      }

      if (courseId) {
        whereClause.courseId = courseId;
      }

      if (accessType) {
        whereClause.accessType = accessType;
      }

      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
        if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
      }

      // Handle expiry status
      if (expiryStatus) {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        if (expiryStatus === 'expired') {
          whereClause.expiresAt = {
            [Op.not]: null,
            [Op.lt]: now
          };
        } else if (expiryStatus === 'active') {
          whereClause[Op.or] = [
            { expiresAt: null },
            { expiresAt: { [Op.gt]: now } }
          ];
        } else if (expiryStatus === 'expiring_soon') {
          whereClause.expiresAt = {
            [Op.between]: [now, sevenDaysFromNow]
          };
        }
      }

      // Build include clause
      const includeClause = [
        {
          model: Course,
          as: 'course',
          required: false,
          include: [{
            model: Department,
            as: 'department',
            attributes: ['id', 'name']
          }],
          where: departmentId ? { departmentId } : {}
        },
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        },
        {
          model: Purchase,
          as: 'purchase',
          attributes: ['id', 'amount', 'currency', 'paymentGateway', 'paymentReference', 'createdAt']
        }
      ];

      // Get all enrollments matching filters
      const enrollments = await CourseEnrollment.findAll({
        where: whereClause,
        include: includeClause,
        order: [['createdAt', 'DESC']]
      });

      if (format === 'csv') {
        // Generate CSV
        const csvRows = [];
        
        // Header
        csvRows.push([
          'Enrollment ID',
          'Student Name',
          'Student Email',
          'Student Phone',
          'Access Type',
          'Course Name',
          'Department',
          'Amount',
          'Currency',
          'Payment Gateway',
          'Payment Reference',
          'Expires At',
          'Is Expired',
          'Days Until Expiry',
          'Credentials Sent',
          'Sent At',
          'Created At'
        ].join(','));

        // Data rows
        for (const enrollment of enrollments) {
          const data = enrollment.toJSON();
          csvRows.push([
            data.id,
            `"${data.studentName}"`,
            data.studentEmail,
            data.studentPhone,
            data.accessType,
            data.course ? `"${data.course.name}"` : 'All Courses',
            data.course?.department?.name || 'N/A',
            data.purchase?.amount || 0,
            data.purchase?.currency || 'NGN',
            data.purchase?.paymentGateway || 'N/A',
            data.purchase?.paymentReference || 'N/A',
            data.expiresAt || 'Never',
            data.isExpired ? 'Yes' : 'No',
            data.daysUntilExpiry || 'N/A',
            data.credentialsSent ? 'Yes' : 'No',
            data.sentAt || 'N/A',
            data.createdAt
          ].join(','));
        }

        return {
          success: true,
          format: 'csv',
          data: csvRows.join('\n')
        };

      } else {
        // Return JSON
        return {
          success: true,
          format: 'json',
          data: enrollments.map(e => e.toJSON())
        };
      }

    } catch (error) {
      console.error('[Enrollment Service] Export enrollments error:', error);
      throw error;
    }
  }

  /**
   * Get enrollments by user
   * @param {number} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} User's enrollments
   */
  async getEnrollmentsByUser(userId, options = {}) {
    try {
      const {
        limit = this.config.pagination.defaultLimit,
        offset = 0,
        includeInactive = false
      } = options;

      console.log(`[Enrollment Service] Getting enrollments for user: ${userId}`);

      const includeClause = [
        {
          model: Course,
          as: 'course',
          where: includeInactive ? {} : { isActive: true },
          include: [{
            model: Department,
            as: 'department',
            attributes: ['id', 'name', 'slug']
          }]
        },
        {
          model: Purchase,
          as: 'purchase',
          attributes: ['id', 'amount', 'currency', 'paymentGateway', 'createdAt']
        }
      ];

      // Get total count
      const totalCount = await CourseEnrollment.count({
        where: { userId },
        include: includeClause.filter(inc => inc.model === Course)
      });

      // Get enrollments
      const enrollments = await CourseEnrollment.findAll({
        where: { userId },
        include: includeClause,
        order: [['createdAt', 'DESC']],
        limit: Math.min(parseInt(limit), this.config.pagination.maxLimit),
        offset: parseInt(offset)
      });

      return {
        success: true,
        enrollments: enrollments.map(enrollment => enrollment.toJSON()),
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          pages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: Math.floor(parseInt(offset) / parseInt(limit)) + 1
        }
      };
    } catch (error) {
      console.error('[Enrollment Service] Get enrollments by user error:', error);
      throw error;
    }
  }

  /**
   * Get enrollment statistics
   * @returns {Promise<Object>} Enrollment statistics
   * 
   * ✅ UPDATED: Now includes access type breakdown and expiry stats
   */
  async getEnrollmentStatistics() {
    try {
      console.log('[Enrollment Service] Getting enrollment statistics');

      const now = new Date();
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const [
        totalEnrollments,
        pendingEnrollments,
        completedEnrollments,
        // ✅ NEW: Access type breakdown
        individualCount,
        monthlyCount,
        yearlyCount,
        // ✅ NEW: Expiry stats
        expiredCount,
        expiringSoonCount,
        activeSubscriptionsCount,
        enrollmentsByDepartment
      ] = await Promise.all([
        CourseEnrollment.count(),
        CourseEnrollment.count({ where: { credentialsSent: false } }),
        CourseEnrollment.count({ where: { credentialsSent: true } }),
        // Access type counts
        CourseEnrollment.count({ where: { accessType: 'individual' } }),
        CourseEnrollment.count({ where: { accessType: 'monthly' } }),
        CourseEnrollment.count({ where: { accessType: 'yearly' } }),
        // Expiry counts
        CourseEnrollment.count({
          where: {
            expiresAt: {
              [Op.not]: null,
              [Op.lt]: now
            }
          }
        }),
        CourseEnrollment.count({
          where: {
            expiresAt: {
              [Op.between]: [now, sevenDaysFromNow]
            }
          }
        }),
        CourseEnrollment.count({
          where: {
            [Op.or]: [
              { expiresAt: null },
              { expiresAt: { [Op.gt]: now } }
            ]
          }
        }),
        CourseEnrollment.findAll({
          attributes: [
            [sequelize.fn('COUNT', sequelize.col('CourseEnrollment.id')), 'count']
          ],
          include: [{
            model: Course,
            as: 'course',
            attributes: [],
            required: false,
            include: [{
              model: Department,
              as: 'department',
              attributes: ['id', 'name']
            }]
          }],
          group: ['course.department.id', 'course.department.name'],
          order: [[sequelize.literal('count'), 'DESC']]
        })
      ]);

      const completionRate = totalEnrollments > 0 
        ? ((completedEnrollments / totalEnrollments) * 100).toFixed(2)
        : 0;

      return {
        total: totalEnrollments,
        pending: pendingEnrollments,
        completed: completedEnrollments,
        completionRate: parseFloat(completionRate),
        // ✅ NEW: Access type breakdown
        byAccessType: {
          individual: individualCount,
          monthly: monthlyCount,
          yearly: yearlyCount
        },
        // ✅ NEW: Expiry stats
        expiryStats: {
          expired: expiredCount,
          expiringSoon: expiringSoonCount,
          active: activeSubscriptionsCount
        },
        byDepartment: enrollmentsByDepartment.map(item => ({
          department: item.course?.department || { id: null, name: 'All Courses' },
          count: parseInt(item.get('count'))
        }))
      };
    } catch (error) {
      console.error('[Enrollment Service] Get statistics error:', error);
      throw error;
    }
  }

  /**
   * ✅ NEW: Calculate enrollment summary for filtered results
   * @param {Object} whereClause - Where conditions
   * @param {Array} includeClause - Include conditions
   * @returns {Promise<Object>} Summary statistics
   */
  async calculateEnrollmentSummary(whereClause, includeClause) {
    try {
      const now = new Date();

      // Count by access type
      const [individual, monthly, yearly] = await Promise.all([
        CourseEnrollment.count({
          where: { ...whereClause, accessType: 'individual' },
          include: includeClause.filter(inc => inc.model === Course)
        }),
        CourseEnrollment.count({
          where: { ...whereClause, accessType: 'monthly' },
          include: includeClause.filter(inc => inc.model === Course)
        }),
        CourseEnrollment.count({
          where: { ...whereClause, accessType: 'yearly' },
          include: includeClause.filter(inc => inc.model === Course)
        })
      ]);

      // Count by expiry status
      const [expired, active] = await Promise.all([
        CourseEnrollment.count({
          where: {
            ...whereClause,
            expiresAt: {
              [Op.not]: null,
              [Op.lt]: now
            }
          },
          include: includeClause.filter(inc => inc.model === Course)
        }),
        CourseEnrollment.count({
          where: {
            ...whereClause,
            [Op.or]: [
              { expiresAt: null },
              { expiresAt: { [Op.gt]: now } }
            ]
          },
          include: includeClause.filter(inc => inc.model === Course)
        })
      ]);

      return {
        byAccessType: {
          individual,
          monthly,
          yearly
        },
        byExpiryStatus: {
          expired,
          active
        }
      };
    } catch (error) {
      console.error('[Enrollment Service] Calculate summary error:', error);
      return {
        byAccessType: { individual: 0, monthly: 0, yearly: 0 },
        byExpiryStatus: { expired: 0, active: 0 }
      };
    }
  }

  /**
   * ✅ NEW: Get enrollments expiring soon
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Expiring enrollments
   */
  async getExpiringSoon(options = {}) {
    try {
      const { days = 7, limit = 50 } = options;

      console.log(`[Enrollment Service] Getting enrollments expiring within ${days} days`);

      const now = new Date();
      const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const enrollments = await CourseEnrollment.findAll({
        where: {
          expiresAt: {
            [Op.between]: [now, futureDate]
          }
        },
        include: [
          {
            model: Course,
            as: 'course',
            required: false,
            include: [{
              model: Department,
              as: 'department',
              attributes: ['id', 'name']
            }]
          },
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstname', 'lastname', 'email']
          },
          {
            model: Purchase,
            as: 'purchase',
            attributes: ['id', 'amount', 'currency', 'createdAt']
          }
        ],
        order: [['expiresAt', 'ASC']],
        limit: parseInt(limit)
      });

      return {
        success: true,
        count: enrollments.length,
        enrollments: enrollments.map(enrollment => enrollment.toJSON())
      };
    } catch (error) {
      console.error('[Enrollment Service] Get expiring soon error:', error);
      throw error;
    }
  }

  /**
   * Validate student details
   * @param {Object} studentDetails - Student details to validate
   * @returns {Object} Validation result
   */
  validateStudentDetails(studentDetails) {
    const { studentName, studentEmail, studentPhone } = studentDetails;
    const errors = [];

    // Validate student name
    if (!studentName || studentName.trim().length === 0) {
      errors.push('Student name is required');
    } else if (studentName.trim().length > this.config.validation.studentName.maxLength) {
      errors.push(`Student name must be less than ${this.config.validation.studentName.maxLength} characters`);
    }

    // Validate student email
    if (!studentEmail || studentEmail.trim().length === 0) {
      errors.push('Student email is required');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(studentEmail.trim())) {
        errors.push('Student email must be a valid email address');
      } else if (studentEmail.trim().length > this.config.validation.studentEmail.maxLength) {
        errors.push(`Student email must be less than ${this.config.validation.studentEmail.maxLength} characters`);
      }
    }

    // Validate student phone
    if (!studentPhone || studentPhone.trim().length === 0) {
      errors.push('Student phone is required');
    } else if (studentPhone.trim().length > this.config.validation.studentPhone.maxLength) {
      errors.push(`Student phone must be less than ${this.config.validation.studentPhone.maxLength} characters`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if user is enrolled in course
   * @param {number} userId - User ID
   * @param {string} courseId - Course ID
   * @returns {Promise<Object|null>} Enrollment if exists
   */
  async checkUserEnrollment(userId, courseId) {
    try {
      const enrollment = await CourseEnrollment.findOne({
        where: { userId, courseId },
        include: [
          {
            model: Course,
            as: 'course',
            attributes: ['id', 'name']
          },
          {
            model: Purchase,
            as: 'purchase',
            attributes: ['id', 'paymentStatus', 'createdAt']
          }
        ]
      });

      return enrollment ? enrollment.toJSON() : null;
    } catch (error) {
      console.error('[Enrollment Service] Check user enrollment error:', error);
      throw error;
    }
  }

  /**
   * Get service configuration
   * @returns {Object} Service configuration
   */
  getConfiguration() {
    return {
      pagination: this.config.pagination,
      validation: this.config.validation
    };
  }
}

module.exports = CourseEnrollmentService;