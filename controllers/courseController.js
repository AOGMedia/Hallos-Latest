const CourseService = require('../services/courseService');
const PaymentRoutingService = require('../services/paymentRoutingService');
const CourseEnrollmentService = require('../services/courseEnrollmentService');
const CoursePricingService = require('../services/coursePricingService');  // ✅ NEW
const User = require('../models/User');

// Initialize services
const courseService = new CourseService();
const paymentRoutingService = new PaymentRoutingService();
const courseEnrollmentService = new CourseEnrollmentService();
const coursePricingService = new CoursePricingService();  // ✅ NEW

/**
 * Course Controller
 * 
 * Handles course catalog browsing and purchase operations
 * Integrates with existing payment infrastructure
 */

/**
 * Get all departments
 * GET /api/courses/departments
 */
exports.getDepartments = async (req, res) => {
  try {
    console.log('[Course Controller] Getting all departments');

    const departments = await courseService.getAllDepartments();

    return res.status(200).json({
      success: true,
      count: departments.length,
      departments
    });
  } catch (error) {
    console.error('[Course Controller] Get departments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch departments'
    });
  }
};

/**
 * Get courses by department
 * GET /api/courses/departments/:id/courses
 */
exports.getCoursesByDepartment = async (req, res) => {
  try {
    const { id: departmentId } = req.params;
    const { limit = 50, offset = 0, search } = req.query;

    console.log(`[Course Controller] Getting courses for department ${departmentId}`);

    // Validate department ID
    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: 'Department ID is required'
      });
    }

    const result = await courseService.getCoursesByDepartment({
      departmentId,
      limit: parseInt(limit),
      offset: parseInt(offset),
      search
    });

    return res.status(200).json({
      success: true,
      department: result.department,
      courses: result.courses,
      pagination: {
        total: result.total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(result.total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[Course Controller] Get courses by department error:', error);
    
    if (error.message === 'Department not found') {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch courses'
    });
  }
};

/**
 * Get course details
 * GET /api/courses/:id
 */
exports.getCourseById = async (req, res) => {
  try {
    const { id: courseId } = req.params;

    console.log(`[Course Controller] Getting course details for ${courseId}`);

    // Validate course ID
    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: 'Course ID is required'
      });
    }

    const course = await courseService.getCourseById(courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    return res.status(200).json({
      success: true,
      course
    });
  } catch (error) {
    console.error('[Course Controller] Get course by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch course details'
    });
  }
};

/**
 * Purchase course or access pass
 * POST /api/courses/purchase
 * 
 * ✅ UPDATED: Now supports individual, monthly, and yearly access types
 */
exports.purchaseCourse = async (req, res) => {
  try {
    const { accessType, courseId, currency, couponCode, studentName, studentEmail, studentPhone } = req.body;
    const userId = req.user.id;
    const idempotencyKey = req.headers['idempotency-key'];

    console.log(`[Course Controller] Processing purchase - User: ${userId}, Access Type: ${accessType}`);

    // Validate idempotency key
    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: 'Idempotency-Key header is required'
      });
    }

    // Validate student details
    if (!studentName || !studentEmail || !studentPhone) {
      return res.status(400).json({
        success: false,
        message: 'Student details (name, email, phone) are required'
      });
    }

    // Validate purchase request using pricing service
    const validation = coursePricingService.validatePurchaseRequest({
      accessType,
      courseId,
      currency,
      couponCode
    });

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.errors
      });
    }

    // Get user details
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // For individual purchases, verify course exists
    let course = null;
    if (accessType === 'individual') {
      course = await courseService.getCourseById(courseId);
      if (!course) {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }

      // Check if user already enrolled in this specific course
      const existingEnrollment = await courseEnrollmentService.checkUserEnrollment(userId, courseId);
      if (existingEnrollment) {
        return res.status(409).json({
          success: false,
          message: 'You are already enrolled in this course'
        });
      }
    }

    // Calculate pricing with discount
    const pricingDetails = coursePricingService.calculateDiscount(
      accessType,
      currency,
      couponCode
    );

    // Calculate expiry date
    const expiresAt = coursePricingService.calculateExpiryDate(accessType);

    // Initialize payment with enhanced metadata
    const result = await paymentRoutingService.initializePayment({
      userId,
      contentType: 'course',
      contentId: courseId || null,  // null for monthly/yearly
      userEmail: user.email,
      idempotencyKey,
      forceCurrency: currency.toUpperCase(),
      metadata: {
        // Student details
        studentName,
        studentEmail,
        studentPhone,
        // Access details
        accessType,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        // Pricing details
        couponCode: pricingDetails.couponApplied ? couponCode : null,
        regularPrice: pricingDetails.regularPrice,
        discount: pricingDetails.savings,
        finalPrice: pricingDetails.finalPrice
      }
    });

    // Build response
    const response = {
      success: true,
      message: result.cached ? 'Payment already initialized (cached)' : 'Payment initialized successfully',
      
      // Access details
      accessType,
      accessDescription: coursePricingService.getAccessTypeDescription(accessType),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      
      // Pricing details
      pricing: {
        currency: pricingDetails.currency,
        regularPrice: pricingDetails.regularPrice,
        finalPrice: pricingDetails.finalPrice,
        discount: pricingDetails.savings,
        discountPercentage: pricingDetails.discountPercentage,
        couponApplied: pricingDetails.couponApplied
      },
      
      // Payment details
      payment: {
        gateway: result.gateway,
        requiredGateway: result.requiredGateway,
        cached: result.cached || false,
        // Handle different payment URL field names from different gateways
        paymentUrl: result.data?.authorizationUrl || result.data?.authorization_url || result.data?.checkoutUrl || result.data?.paymentUrl || result.data?.url,
        reference: result.data?.reference || result.data?.sessionId
      }
    };

    // Add course details for individual purchases
    if (accessType === 'individual' && course) {
      response.course = {
        id: course.id,
        name: course.name,
        department: course.department?.name
      };
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('[Course Controller] Purchase error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to initialize course purchase'
    });
  }
};

/**
 * Get user's course enrollments
 * GET /api/courses/my-enrollments
 */
exports.getMyEnrollments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    console.log(`[Course Controller] Getting enrollments for user ${userId}`);

    const result = await courseEnrollmentService.getEnrollmentsByUser(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json({
      success: true,
      enrollments: result.enrollments,
      pagination: {
        total: result.total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(result.total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[Course Controller] Get my enrollments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch your course enrollments'
    });
  }
};

/**
 * Search courses across all departments
 * GET /api/courses/search
 */
exports.searchCourses = async (req, res) => {
  try {
    const { q: query, department, limit = 50, offset = 0 } = req.query;

    console.log(`[Course Controller] Searching courses with query: ${query}`);

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    const result = await courseService.searchCourses({
      query: query.trim(),
      departmentId: department,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json({
      success: true,
      query: query.trim(),
      courses: result.courses,
      pagination: {
        total: result.total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(result.total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[Course Controller] Search courses error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to search courses'
    });
  }
};