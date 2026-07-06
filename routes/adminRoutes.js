const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const financialRateLimiterController = require('../controllers/financialRateLimiterController');
const fraudDetectionController = require('../controllers/fraudDetectionController');
const withdrawalLimitController = require('../controllers/withdrawalLimitController');
const auditTrailController = require('../controllers/auditTrailController');
const manualReviewController = require('../controllers/manualReviewController');
const transactionHistoryController = require('../controllers/transactionHistoryController');
const adminDashboardController = require('../controllers/adminDashboardController');

/**
 * Admin Routes for System Management
 * 
 * All routes require authentication and admin privileges
 */

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Apply admin role check middleware to all routes
router.use(adminMiddleware);

/**
 * Financial Rate Limiter Management
 */

// Get rate limiter statistics
router.get('/rate-limiter/stats', financialRateLimiterController.getRateLimiterStats);

// Get rate limiter configuration
router.get('/rate-limiter/config', financialRateLimiterController.getRateLimiterConfig);

// Unblock user from rate limiting
router.post('/rate-limiter/unblock-user', financialRateLimiterController.unblockUserFromRateLimit);

// Unblock IP from rate limiting
router.post('/rate-limiter/unblock-ip', financialRateLimiterController.unblockIPFromRateLimit);

/**
 * Fraud Detection Management
 */

// Get fraud detection statistics
router.get('/fraud-detection/stats', fraudDetectionController.getFraudDetectionStats);

// Get fraud detection configuration
router.get('/fraud-detection/config', fraudDetectionController.getFraudDetectionConfig);

// Get user risk profile
router.get('/fraud-detection/user/:userId', fraudDetectionController.getUserRiskProfile);

// Unblock user from fraud detection
router.post('/fraud-detection/unblock-user', fraudDetectionController.unblockUserFromFraudDetection);

// Analyze transaction manually (admin tool)
router.post('/fraud-detection/analyze', fraudDetectionController.analyzeTransaction);

// Get recent suspicious activities
router.get('/fraud-detection/suspicious-activities', fraudDetectionController.getSuspiciousActivities);

/**
 * Withdrawal Limit Management
 */

// Get system-wide withdrawal statistics
router.get('/withdrawal-limits/system-stats', withdrawalLimitController.getSystemWithdrawalStats);

// Get user withdrawal statistics
router.get('/withdrawal-limits/user/:userId', withdrawalLimitController.getUserWithdrawalStats);

// Set user tier (default, vip, business)
router.post('/withdrawal-limits/set-tier', withdrawalLimitController.setUserTier);

// Set custom limits for user
router.post('/withdrawal-limits/set-custom-limits', withdrawalLimitController.setCustomLimits);

// Admin override limits for user
router.post('/withdrawal-limits/admin-override', withdrawalLimitController.adminOverrideLimits);

// Suspend user withdrawal privileges
router.post('/withdrawal-limits/suspend-user', withdrawalLimitController.suspendUser);

// Restore user withdrawal privileges
router.post('/withdrawal-limits/restore-user', withdrawalLimitController.restoreUser);

// Reset user to default limits
router.post('/withdrawal-limits/reset-user', withdrawalLimitController.resetUserToDefault);

// Check withdrawal limits (preview)
router.post('/withdrawal-limits/check-limits', withdrawalLimitController.checkWithdrawalLimits);

/**
 * Audit Trail Management
 */

// Get audit logs with filtering
router.get('/audit/logs', auditTrailController.getAuditLogs);

// Generate audit report
router.post('/audit/report', auditTrailController.generateAuditReport);

// Verify audit trail integrity
router.post('/audit/verify', auditTrailController.verifyAuditIntegrity);

// Archive old audit logs
router.post('/audit/archive', auditTrailController.archiveOldLogs);

// Get audit trail statistics
router.get('/audit/stats', auditTrailController.getAuditStats);

// Log custom audit event (admin tool)
router.post('/audit/log-event', auditTrailController.logCustomEvent);

// Get audit configuration
router.get('/audit/config', auditTrailController.getAuditConfig);

/**
 * Manual Review Queue Management
 */

// Get review queue for reviewer
router.get('/review/queue', manualReviewController.getReviewQueue);

// Get specific review item
router.get('/review/item/:reviewId', manualReviewController.getReviewItem);

// Assign reviewer to review item
router.post('/review/assign', manualReviewController.assignReviewer);

// Submit review decision
router.post('/review/decision', manualReviewController.submitDecision);

// Add item to review queue
router.post('/review/add', manualReviewController.addToQueue);

// Get review statistics
router.get('/review/stats', manualReviewController.getReviewStats);

// Get service statistics
router.get('/review/service-stats', manualReviewController.getServiceStats);

// Get reviewer workload
router.get('/review/workload/:reviewerId', manualReviewController.getReviewerWorkload);

// Get review configuration
router.get('/review/config', manualReviewController.getReviewConfig);

/**
 * Transaction History Management (Admin)
 */

// Get system-wide transaction analytics
router.get('/transactions/analytics', (req, res, next) => {
  // Remove userId filter for admin access
  req.query.adminAccess = true;
  transactionHistoryController.getTransactionAnalytics.call(transactionHistoryController, req, res);
});

// Get transaction by ID (admin can access any transaction)
router.get('/transactions/:id', (req, res, next) => {
  // Admin can access any transaction without user restriction
  req.adminAccess = true;
  transactionHistoryController.getTransactionById.call(transactionHistoryController, req, res);
});

// Search all transactions (admin access)
router.post('/transactions/search', (req, res, next) => {
  // Remove userId filter for admin access
  req.body.adminAccess = true;
  transactionHistoryController.searchTransactions.call(transactionHistoryController, req, res);
});

// Export system-wide transaction history
router.get('/transactions/export', (req, res, next) => {
  // Remove userId filter for admin access
  req.query.adminAccess = true;
  transactionHistoryController.exportTransactionHistory.call(transactionHistoryController, req, res);
});

// Get system-wide transaction summary
router.get('/transactions/summary', (req, res, next) => {
  // Remove userId filter for admin access
  req.query.adminAccess = true;
  transactionHistoryController.getTransactionSummary.call(transactionHistoryController, req, res);
});

/**
 * Platform Dashboard & User Management
 */
router.get('/dashboard', adminDashboardController.getDashboard);
router.get('/revenue', adminDashboardController.getRevenue);
router.get('/content-stats', adminDashboardController.getContentStats);

// User management
router.get('/users', adminDashboardController.getUsers);
router.get('/users/:id', adminDashboardController.getUserById);
router.patch('/users/:id/role', adminDashboardController.updateUserRole);

// Payout management
router.get('/payouts', adminDashboardController.getPayouts);
router.patch('/payouts/:id/approve', adminDashboardController.approvePayout);
router.patch('/payouts/:id/reject', adminDashboardController.rejectPayout);

/**
 * Course Enrollment Management (Admin)
 */
const courseEnrollmentController = require('../controllers/courseEnrollmentController');

router.get('/course-enrollments', courseEnrollmentController.getEnrollments);
router.get('/course-enrollments/expiring-soon', courseEnrollmentController.getExpiringSoon);
router.get('/course-enrollments/stats', courseEnrollmentController.getEnrollmentStats);
router.get('/course-enrollments/export', courseEnrollmentController.exportEnrollments);
router.get('/course-enrollments/:id', courseEnrollmentController.getEnrollmentById);
router.patch('/course-enrollments/:id/mark-sent', courseEnrollmentController.markCredentialsSent);
router.patch('/course-enrollments/batch-mark-sent', courseEnrollmentController.batchMarkCredentialsSent);

module.exports = router;