const AuditTrailService = require('../services/auditTrailService');

// Create singleton instance
const auditTrailService = new AuditTrailService();

/**
 * Audit Trail Management Controller
 * 
 * Provides admin endpoints for audit trail management:
 * - View audit logs
 * - Generate audit reports
 * - Verify audit integrity
 * - Archive old logs
 */

/**
 * Get audit logs with filtering
 * GET /api/admin/audit/logs
 */
exports.getAuditLogs = async (req, res) => {
  try {
    const {
      userId,
      category,
      eventType,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = req.query;

    const filters = {
      userId: userId ? parseInt(userId) : undefined,
      category,
      eventType,
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const logs = await auditTrailService.getAuditLogs(filters);

    return res.status(200).json({
      success: true,
      logs,
      count: logs.length,
      filters,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Audit Trail Controller] Get logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get audit logs'
    });
  }
};

/**
 * Generate audit report
 * POST /api/admin/audit/report
 */
exports.generateAuditReport = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      category,
      userId,
      includeStatistics = true
    } = req.body;

    const criteria = {
      startDate,
      endDate,
      category,
      userId: userId ? parseInt(userId) : undefined,
      includeStatistics
    };

    const report = await auditTrailService.generateReport(criteria);

    return res.status(200).json({
      success: true,
      report
    });
  } catch (error) {
    console.error('[Audit Trail Controller] Generate report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate audit report'
    });
  }
};

/**
 * Verify audit trail integrity
 * POST /api/admin/audit/verify
 */
exports.verifyAuditIntegrity = async (req, res) => {
  try {
    const { auditId } = req.body;

    if (!auditId) {
      return res.status(400).json({
        success: false,
        message: 'Audit ID is required'
      });
    }

    const verification = await auditTrailService.verifyIntegrity(auditId);

    return res.status(verification.valid ? 200 : 400).json({
      success: verification.valid,
      verification
    });
  } catch (error) {
    console.error('[Audit Trail Controller] Verify integrity error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify audit integrity'
    });
  }
};

/**
 * Archive old audit logs
 * POST /api/admin/audit/archive
 */
exports.archiveOldLogs = async (req, res) => {
  try {
    const { retentionDays } = req.body;

    const result = await auditTrailService.archiveOldLogs(
      retentionDays ? parseInt(retentionDays) : null
    );

    return res.status(200).json({
      success: true,
      result
    });
  } catch (error) {
    console.error('[Audit Trail Controller] Archive logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to archive audit logs'
    });
  }
};

/**
 * Get audit trail statistics
 * GET /api/admin/audit/stats
 */
exports.getAuditStats = async (req, res) => {
  try {
    const stats = auditTrailService.getStatistics();

    return res.status(200).json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Audit Trail Controller] Get stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get audit statistics'
    });
  }
};

/**
 * Log custom audit event (admin tool)
 * POST /api/admin/audit/log-event
 */
exports.logCustomEvent = async (req, res) => {
  try {
    const {
      eventType,
      category,
      targetUserId,
      data,
      metadata
    } = req.body;

    if (!eventType) {
      return res.status(400).json({
        success: false,
        message: 'Event type is required'
      });
    }

    const eventData = {
      eventType,
      category,
      userId: targetUserId ? parseInt(targetUserId) : req.user?.id,
      sessionId: req.sessionID,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      data: {
        ...data,
        adminUserId: req.user?.id,
        adminAction: true
      },
      metadata
    };

    const result = await auditTrailService.logEvent(eventData);

    return res.status(200).json({
      success: true,
      result
    });
  } catch (error) {
    console.error('[Audit Trail Controller] Log custom event error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to log custom event'
    });
  }
};

/**
 * Get audit event types and categories
 * GET /api/admin/audit/config
 */
exports.getAuditConfig = async (req, res) => {
  try {
    const stats = auditTrailService.getStatistics();
    
    return res.status(200).json({
      success: true,
      config: {
        categories: stats.config.categories,
        eventTypes: stats.config.eventTypes,
        retention: stats.config.retention
      }
    });
  } catch (error) {
    console.error('[Audit Trail Controller] Get config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get audit configuration'
    });
  }
};