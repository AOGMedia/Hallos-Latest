const CourseEnrollmentService = require('../services/courseEnrollmentService');

// Initialize service
const courseEnrollmentService = new CourseEnrollmentService();

/**
 * Course Enrollment Controller (Admin)
 * 
 * Handles admin operations for course enrollments:
 * - View confirmed course payments with student details
 * - Toggle credentials sent status
 * - Track admin processing
 */

/**
 * Get course enrollments for admin dashboard
 * GET /api/admin/course-enrollments
 * 
 * ✅ UPDATED: Now supports filtering by accessType and expiry status
 */
exports.getEnrollments = async (req, res) => {
  try {
    const { 
      status = 'all', 
      limit = 50, 
      offset = 0,
      search,
      courseId,
      departmentId,
      credentialsSent,
      accessType,  // ✅ NEW: Filter by access type
      expiryStatus  // ✅ NEW: Filter by expiry (active, expired, expiring_soon)
    } = req.query;

    console.log('[Course Enrollment Controller] Getting enrollments for admin dashboard');

    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    // Add optional filters
    if (search) filters.search = search;
    if (courseId) filters.courseId = courseId;
    if (departmentId) filters.departmentId = departmentId;
    if (credentialsSent !== undefined) {
      filters.credentialsSent = credentialsSent === 'true';
    }
    
    // ✅ NEW: Access type filter
    if (accessType && ['individual', 'monthly', 'yearly'].includes(accessType)) {
      filters.accessType = accessType;
    }
    
    // ✅ NEW: Expiry status filter
    if (expiryStatus && ['active', 'expired', 'expiring_soon'].includes(expiryStatus)) {
      filters.expiryStatus = expiryStatus;
    }

    const result = await courseEnrollmentService.getEnrollmentsForAdmin(filters);

    return res.status(200).json({
      success: true,
      enrollments: result.enrollments,
      summary: result.summary,
      pagination: {
        total: result.pagination.total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: result.pagination.pages
      },
      filters: {
        status,
        search,
        courseId,
        departmentId,
        credentialsSent,
        accessType,  // ✅ NEW
        expiryStatus  // ✅ NEW
      }
    });
  } catch (error) {
    console.error('[Course Enrollment Controller] Get enrollments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch course enrollments'
    });
  }
};

/**
 * Get specific enrollment details
 * GET /api/admin/course-enrollments/:id
 */
exports.getEnrollmentById = async (req, res) => {
  try {
    const { id: enrollmentId } = req.params;

    console.log(`[Course Enrollment Controller] Getting enrollment details for ${enrollmentId}`);

    if (!enrollmentId) {
      return res.status(400).json({
        success: false,
        message: 'Enrollment ID is required'
      });
    }

    const enrollment = await courseEnrollmentService.getEnrollmentDetails(enrollmentId);

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found'
      });
    }

    return res.status(200).json({
      success: true,
      enrollment
    });
  } catch (error) {
    console.error('[Course Enrollment Controller] Get enrollment by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch enrollment details'
    });
  }
};

/**
 * Toggle credentials sent status
 * PATCH /api/admin/course-enrollments/:id/mark-sent
 */
exports.markCredentialsSent = async (req, res) => {
  try {
    const { id: enrollmentId } = req.params;
    const { sent = true, notes } = req.body;
    const adminId = req.user.id; // Assuming admin user is in req.user

    console.log(`[Course Enrollment Controller] Toggling credentials sent for enrollment ${enrollmentId}`);

    if (!enrollmentId) {
      return res.status(400).json({
        success: false,
        message: 'Enrollment ID is required'
      });
    }

    // Validate enrollment exists
    const enrollment = await courseEnrollmentService.getEnrollmentDetails(enrollmentId);
    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found'
      });
    }

    // Toggle credentials sent status
    const result = await courseEnrollmentService.markCredentialsSent({
      enrollmentId,
      sent: Boolean(sent),
      adminId,
      notes
    });

    return res.status(200).json({
      success: true,
      message: sent ? 'Credentials marked as sent' : 'Credentials marked as not sent',
      enrollment: result.enrollment,
      previousStatus: result.previousStatus
    });
  } catch (error) {
    console.error('[Course Enrollment Controller] Mark credentials sent error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update credentials status'
    });
  }
};

/**
 * Batch update credentials sent status
 * PATCH /api/admin/course-enrollments/batch-mark-sent
 */
exports.batchMarkCredentialsSent = async (req, res) => {
  try {
    const { enrollmentIds, sent = true, notes } = req.body;
    const adminId = req.user.id;

    console.log(`[Course Enrollment Controller] Batch updating credentials sent for ${enrollmentIds?.length} enrollments`);

    if (!enrollmentIds || !Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Array of enrollment IDs is required'
      });
    }

    if (enrollmentIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 100 enrollments can be processed at once'
      });
    }

    const results = await courseEnrollmentService.batchMarkCredentialsSent({
      enrollmentIds,
      sent: Boolean(sent),
      adminId,
      notes
    });

    return res.status(200).json({
      success: true,
      message: `Batch update completed: ${results.successful} successful, ${results.failed} failed`,
      results: {
        successful: results.successful,
        failed: results.failed,
        errors: results.errors
      }
    });
  } catch (error) {
    console.error('[Course Enrollment Controller] Batch mark credentials sent error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to batch update credentials status'
    });
  }
};

/**
 * Get enrollment statistics for admin dashboard
 * GET /api/admin/course-enrollments/stats
 * 
 * ✅ UPDATED: Now includes access type breakdown and expiry stats
 */
exports.getEnrollmentStats = async (req, res) => {
  try {
    const { period = 'month', departmentId, courseId } = req.query;

    console.log('[Course Enrollment Controller] Getting enrollment statistics');

    const filters = { period };
    if (departmentId) filters.departmentId = departmentId;
    if (courseId) filters.courseId = courseId;

    const stats = await courseEnrollmentService.getEnrollmentStatistics(filters);

    return res.status(200).json({
      success: true,
      stats,
      period,
      filters: {
        departmentId,
        courseId
      }
    });
  } catch (error) {
    console.error('[Course Enrollment Controller] Get enrollment stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch enrollment statistics'
    });
  }
};

/**
 * ✅ NEW: Get enrollments expiring soon (within 7 days)
 * GET /api/admin/course-enrollments/expiring-soon
 */
exports.getExpiringSoon = async (req, res) => {
  try {
    const { days = 7, limit = 50 } = req.query;

    console.log(`[Course Enrollment Controller] Getting enrollments expiring within ${days} days`);

    const result = await courseEnrollmentService.getExpiringSoon({
      days: parseInt(days),
      limit: parseInt(limit)
    });

    return res.status(200).json({
      success: true,
      count: result.count,
      enrollments: result.enrollments,
      daysThreshold: parseInt(days)
    });
  } catch (error) {
    console.error('[Course Enrollment Controller] Get expiring soon error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch expiring enrollments'
    });
  }
};

/**
 * Export enrollments to CSV
 * GET /api/admin/course-enrollments/export
 */
exports.exportEnrollments = async (req, res) => {
  try {
    const { 
      format = 'csv',
      credentialsSent,
      courseId,
      departmentId,
      startDate,
      endDate
    } = req.query;

    console.log('[Course Enrollment Controller] Exporting enrollments');

    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({
        success: false,
        message: 'Format must be csv or json'
      });
    }

    const filters = {};
    if (credentialsSent !== undefined) filters.credentialsSent = credentialsSent === 'true';
    if (courseId) filters.courseId = courseId;
    if (departmentId) filters.departmentId = departmentId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const result = await courseEnrollmentService.exportEnrollments(filters, format);

    // Set appropriate headers
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `course-enrollments-${timestamp}.${format}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(result.data);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.json(result.data);
    }
  } catch (error) {
    console.error('[Course Enrollment Controller] Export enrollments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to export enrollments'
    });
  }
};