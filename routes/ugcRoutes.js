const express = require('express');
const router = express.Router();
const ugcController = require('../controllers/ugcController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

/**
 * UGC Agency Routes
 * 
 * Public/User Routes (authenticated):
 * - GET /api/ugc/companies - Get all companies (with filters)
 * - GET /api/ugc/industries - Get all unique industries
 * - GET /api/ugc/companies/:id - Get single company
 * - POST /api/ugc/companies/:id/collaborate - Send collaboration request
 * - GET /api/ugc/my-requests - Get user's collaboration history
 * 
 * Admin Routes (admin only):
 * - GET /api/ugc/admin/requests - Get all collaboration requests
 * - GET /api/ugc/admin/stats - Get collaboration statistics
 * - PATCH /api/ugc/admin/requests/:id - Update request status
 */

// ==================== USER ROUTES ====================

/**
 * @route   GET /api/ugc/companies
 * @desc    Get all companies with filters and search
 * @access  Public (no auth required for browsing)
 * @query   industry, search, page, limit
 */
router.get('/companies', ugcController.getAllCompanies);

/**
 * @route   GET /api/ugc/industries
 * @desc    Get all unique industries for filtering
 * @access  Public
 */
router.get('/industries', ugcController.getAllIndustries);

/**
 * @route   GET /api/ugc/companies/:id
 * @desc    Get single company details
 * @access  Public
 */
router.get('/companies/:id', ugcController.getCompanyById);

/**
 * @route   POST /api/ugc/companies/:id/collaborate
 * @desc    Send collaboration request to company
 * @access  Private (authenticated users only)
 * @body    { message: string }
 */
router.post('/companies/:id/collaborate', authMiddleware, ugcController.sendCollaborationRequest);

/**
 * @route   GET /api/ugc/my-requests
 * @desc    Get user's collaboration request history
 * @access  Private (authenticated users only)
 */
router.get('/my-requests', authMiddleware, ugcController.getMyCollaborationRequests);

// ==================== ADMIN ROUTES ====================

/**
 * @route   GET /api/ugc/admin/requests
 * @desc    Get all collaboration requests with filters
 * @access  Private (admin only)
 * @query   status, companyId, userId, page, limit
 */
router.get('/admin/requests', authMiddleware, adminMiddleware, ugcController.getAllCollaborationRequests);

/**
 * @route   GET /api/ugc/admin/stats
 * @desc    Get collaboration statistics
 * @access  Private (admin only)
 */
router.get('/admin/stats', authMiddleware, adminMiddleware, ugcController.getCollaborationStats);

/**
 * @route   PATCH /api/ugc/admin/requests/:id
 * @desc    Update collaboration request status
 * @access  Private (admin only)
 * @body    { status: string }
 */
router.patch('/admin/requests/:id', authMiddleware, adminMiddleware, ugcController.updateCollaborationRequestStatus);

module.exports = router;
