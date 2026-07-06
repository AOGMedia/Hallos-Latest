/**
 * Manual Review Queue Service
 * 
 * Provides manual review queue system for flagged transactions:
 * - Review queue for flagged transactions
 * - Reviewer assignment and workflow management
 * - Review decision tracking and audit
 * - Escalation and priority management
 * 
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5
 */

class ManualReviewService {
  constructor() {
    // Review configuration
    this.config = {
      // Review priorities
      priorities: {
        LOW: 'low',
        MEDIUM: 'medium',
        HIGH: 'high',
        CRITICAL: 'critical'
      },
      
      // Review statuses
      statuses: {
        PENDING: 'pending',
        IN_REVIEW: 'in_review',
        APPROVED: 'approved',
        REJECTED: 'rejected',
        ESCALATED: 'escalated',
        EXPIRED: 'expired'
      },
      
      // Review types
      types: {
        FRAUD_DETECTION: 'fraud_detection',
        HIGH_AMOUNT: 'high_amount',
        SUSPICIOUS_PATTERN: 'suspicious_pattern',
        COMPLIANCE: 'compliance',
        MANUAL_FLAG: 'manual_flag',
        SYSTEM_ERROR: 'system_error'
      },
      
      // SLA times (in minutes)
      slaMinutes: {
        critical: 30,    // 30 minutes
        high: 120,       // 2 hours
        medium: 480,     // 8 hours
        low: 1440        // 24 hours
      },
      
      // Auto-escalation settings
      escalation: {
        enabled: true,
        thresholds: {
          critical: 60,    // Escalate after 1 hour
          high: 240,       // Escalate after 4 hours
          medium: 720,     // Escalate after 12 hours
          low: 2880        // Escalate after 48 hours
        }
      }
    };

    // In-memory stores (in production, use Redis/Database)
    this.reviewQueue = new Map();        // Active review items
    this.reviewHistory = new Map();      // Completed reviews
    this.reviewerAssignments = new Map(); // Reviewer workloads
    this.reviewerStats = new Map();      // Reviewer statistics
    
    // Start background processes
    this.startEscalationMonitor();
    this.startSLAMonitor();
  }

  /**
   * Add item to review queue
   * @param {Object} reviewItem - Item to review
   * @returns {Promise<Object>} Queue result
   */
  async addToQueue(reviewItem) {
    try {
      const {
        transactionId,
        userId,
        type,
        priority = 'medium',
        data,
        metadata = {},
        flaggedBy = 'system'
      } = reviewItem;

      console.log(`[Manual Review] Adding item to queue: ${transactionId} (${type})`);

      // Generate review ID
      const reviewId = this.generateReviewId();
      
      // Calculate SLA deadline
      const slaDeadline = this.calculateSLADeadline(priority);
      const escalationTime = this.calculateEscalationTime(priority);

      // Create review item
      const queueItem = {
        reviewId,
        transactionId,
        userId,
        type,
        priority,
        status: this.config.statuses.PENDING,
        data: this.sanitizeReviewData(data),
        metadata: {
          ...metadata,
          flaggedBy,
          flaggedAt: new Date().toISOString(),
          slaDeadline: slaDeadline.toISOString(),
          escalationTime: escalationTime.toISOString()
        },
        assignedReviewer: null,
        assignedAt: null,
        reviewStarted: null,
        reviewCompleted: null,
        decision: null,
        reviewNotes: null,
        escalated: false,
        escalationHistory: []
      };

      // Add to queue
      this.reviewQueue.set(reviewId, queueItem);

      // Try to auto-assign reviewer
      await this.autoAssignReviewer(reviewId);

      console.log(`[Manual Review] Item added to queue: ${reviewId}`);

      return {
        success: true,
        reviewId,
        queuePosition: this.getQueuePosition(reviewId),
        slaDeadline: slaDeadline.toISOString(),
        estimatedReviewTime: this.estimateReviewTime(priority)
      };
    } catch (error) {
      console.error('[Manual Review] Add to queue error:', error);
      throw error;
    }
  }

  /**
   * Assign reviewer to review item
   * @param {string} reviewId - Review ID
   * @param {number} reviewerId - Reviewer user ID
   * @returns {Promise<Object>} Assignment result
   */
  async assignReviewer(reviewId, reviewerId) {
    try {
      const reviewItem = this.reviewQueue.get(reviewId);
      
      if (!reviewItem) {
        return {
          success: false,
          message: 'Review item not found'
        };
      }

      if (reviewItem.status !== this.config.statuses.PENDING) {
        return {
          success: false,
          message: `Review item is already ${reviewItem.status}`
        };
      }

      // Update assignment
      reviewItem.assignedReviewer = reviewerId;
      reviewItem.assignedAt = new Date().toISOString();
      reviewItem.status = this.config.statuses.IN_REVIEW;

      // Update reviewer workload
      this.updateReviewerWorkload(reviewerId, 1);

      console.log(`[Manual Review] Assigned reviewer ${reviewerId} to review ${reviewId}`);

      return {
        success: true,
        message: 'Reviewer assigned successfully',
        assignedReviewer: reviewerId,
        assignedAt: reviewItem.assignedAt
      };
    } catch (error) {
      console.error('[Manual Review] Assign reviewer error:', error);
      return {
        success: false,
        message: 'Failed to assign reviewer'
      };
    }
  }

  /**
   * Submit review decision
   * @param {string} reviewId - Review ID
   * @param {Object} decision - Review decision
   * @returns {Promise<Object>} Decision result
   */
  async submitDecision(reviewId, decision) {
    try {
      const {
        reviewerId,
        action, // 'approve', 'reject', 'escalate'
        notes,
        metadata = {}
      } = decision;

      const reviewItem = this.reviewQueue.get(reviewId);
      
      if (!reviewItem) {
        return {
          success: false,
          message: 'Review item not found'
        };
      }

      if (reviewItem.assignedReviewer !== reviewerId) {
        return {
          success: false,
          message: 'Review not assigned to this reviewer'
        };
      }

      if (reviewItem.status !== this.config.statuses.IN_REVIEW) {
        return {
          success: false,
          message: `Review item is ${reviewItem.status}, cannot submit decision`
        };
      }

      console.log(`[Manual Review] Submitting decision for ${reviewId}: ${action}`);

      // Update review item
      reviewItem.decision = action;
      reviewItem.reviewNotes = notes;
      reviewItem.reviewCompleted = new Date().toISOString();
      reviewItem.metadata.reviewDuration = this.calculateReviewDuration(reviewItem);
      reviewItem.metadata.decisionMetadata = metadata;

      // Set final status
      if (action === 'approve') {
        reviewItem.status = this.config.statuses.APPROVED;
      } else if (action === 'reject') {
        reviewItem.status = this.config.statuses.REJECTED;
      } else if (action === 'escalate') {
        reviewItem.status = this.config.statuses.ESCALATED;
        reviewItem.escalated = true;
        reviewItem.escalationHistory.push({
          escalatedBy: reviewerId,
          escalatedAt: new Date().toISOString(),
          reason: notes,
          previousPriority: reviewItem.priority
        });
        // Increase priority for escalation
        reviewItem.priority = this.getNextPriorityLevel(reviewItem.priority);
      }

      // Move to history and remove from active queue
      this.reviewHistory.set(reviewId, { ...reviewItem });
      this.reviewQueue.delete(reviewId);

      // Update reviewer stats
      this.updateReviewerStats(reviewerId, action, reviewItem);
      this.updateReviewerWorkload(reviewerId, -1);

      // If escalated, re-add to queue with higher priority
      if (action === 'escalate') {
        reviewItem.assignedReviewer = null;
        reviewItem.assignedAt = null;
        reviewItem.status = this.config.statuses.PENDING;
        this.reviewQueue.set(reviewId, reviewItem);
        await this.autoAssignReviewer(reviewId);
      }

      console.log(`[Manual Review] Decision submitted for ${reviewId}: ${action}`);

      return {
        success: true,
        message: 'Review decision submitted successfully',
        decision: action,
        finalStatus: reviewItem.status,
        reviewDuration: reviewItem.metadata.reviewDuration
      };
    } catch (error) {
      console.error('[Manual Review] Submit decision error:', error);
      return {
        success: false,
        message: 'Failed to submit review decision'
      };
    }
  }

  /**
   * Get review queue for reviewer
   * @param {number} reviewerId - Reviewer ID
   * @param {Object} filters - Filter options
   * @returns {Array} Review items
   */
  getReviewerQueue(reviewerId, filters = {}) {
    const { priority, type, status } = filters;
    
    const items = Array.from(this.reviewQueue.values())
      .filter(item => {
        if (item.assignedReviewer && item.assignedReviewer !== reviewerId) {
          return false;
        }
        
        if (priority && item.priority !== priority) return false;
        if (type && item.type !== type) return false;
        if (status && item.status !== status) return false;
        
        return true;
      })
      .sort((a, b) => {
        // Sort by priority and then by flagged time
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const aPriority = priorityOrder[a.priority] || 0;
        const bPriority = priorityOrder[b.priority] || 0;
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        
        return new Date(a.metadata.flaggedAt) - new Date(b.metadata.flaggedAt);
      });

    return items;
  }

  /**
   * Get review item details
   * @param {string} reviewId - Review ID
   * @returns {Object|null} Review item
   */
  getReviewItem(reviewId) {
    return this.reviewQueue.get(reviewId) || this.reviewHistory.get(reviewId) || null;
  }

  /**
   * Get review statistics
   * @param {Object} filters - Filter options
   * @returns {Object} Statistics
   */
  getReviewStatistics(filters = {}) {
    const { startDate, endDate, reviewerId } = filters;
    
    const allItems = [
      ...Array.from(this.reviewQueue.values()),
      ...Array.from(this.reviewHistory.values())
    ];

    let filteredItems = allItems;
    
    if (startDate || endDate) {
      filteredItems = allItems.filter(item => {
        const flaggedAt = new Date(item.metadata.flaggedAt);
        if (startDate && flaggedAt < new Date(startDate)) return false;
        if (endDate && flaggedAt > new Date(endDate)) return false;
        return true;
      });
    }
    
    if (reviewerId) {
      filteredItems = filteredItems.filter(item => 
        item.assignedReviewer === reviewerId
      );
    }

    const stats = {
      total: filteredItems.length,
      byStatus: {},
      byPriority: {},
      byType: {},
      avgReviewTime: 0,
      slaCompliance: 0,
      escalationRate: 0
    };

    let totalReviewTime = 0;
    let completedReviews = 0;
    let slaCompliant = 0;
    let escalated = 0;

    filteredItems.forEach(item => {
      // Status breakdown
      stats.byStatus[item.status] = (stats.byStatus[item.status] || 0) + 1;
      
      // Priority breakdown
      stats.byPriority[item.priority] = (stats.byPriority[item.priority] || 0) + 1;
      
      // Type breakdown
      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
      
      // Review time calculation
      if (item.reviewCompleted && item.metadata.reviewDuration) {
        totalReviewTime += item.metadata.reviewDuration;
        completedReviews++;
        
        // SLA compliance check
        const slaMinutes = this.config.slaMinutes[item.priority] || 1440;
        if (item.metadata.reviewDuration <= slaMinutes * 60 * 1000) {
          slaCompliant++;
        }
      }
      
      // Escalation tracking
      if (item.escalated) {
        escalated++;
      }
    });

    if (completedReviews > 0) {
      stats.avgReviewTime = totalReviewTime / completedReviews;
      stats.slaCompliance = (slaCompliant / completedReviews) * 100;
    }
    
    if (filteredItems.length > 0) {
      stats.escalationRate = (escalated / filteredItems.length) * 100;
    }

    return stats;
  }

  /**
   * Auto-assign reviewer based on workload and expertise
   * @param {string} reviewId - Review ID
   * @returns {Promise<boolean>} Assignment success
   */
  async autoAssignReviewer(reviewId) {
    try {
      const reviewItem = this.reviewQueue.get(reviewId);
      if (!reviewItem || reviewItem.assignedReviewer) {
        return false;
      }

      // Simple auto-assignment logic (in production, use more sophisticated logic)
      const availableReviewers = this.getAvailableReviewers();
      
      if (availableReviewers.length === 0) {
        console.log(`[Manual Review] No available reviewers for ${reviewId}`);
        return false;
      }

      // Assign to reviewer with lowest workload
      const selectedReviewer = availableReviewers.reduce((min, reviewer) => 
        reviewer.workload < min.workload ? reviewer : min
      );

      await this.assignReviewer(reviewId, selectedReviewer.id);
      return true;
    } catch (error) {
      console.error('[Manual Review] Auto-assign error:', error);
      return false;
    }
  }

  /**
   * Get available reviewers
   * @returns {Array} Available reviewers
   */
  getAvailableReviewers() {
    // Mock reviewer data (in production, fetch from user database)
    const mockReviewers = [
      { id: 1001, name: 'Reviewer 1', workload: this.getReviewerWorkload(1001) },
      { id: 1002, name: 'Reviewer 2', workload: this.getReviewerWorkload(1002) },
      { id: 1003, name: 'Reviewer 3', workload: this.getReviewerWorkload(1003) }
    ];

    return mockReviewers.filter(reviewer => reviewer.workload < 10); // Max 10 active reviews
  }

  /**
   * Get reviewer workload
   * @param {number} reviewerId - Reviewer ID
   * @returns {number} Current workload
   */
  getReviewerWorkload(reviewerId) {
    return this.reviewerAssignments.get(reviewerId) || 0;
  }

  /**
   * Update reviewer workload
   * @param {number} reviewerId - Reviewer ID
   * @param {number} change - Workload change (+1 or -1)
   */
  updateReviewerWorkload(reviewerId, change) {
    const currentWorkload = this.getReviewerWorkload(reviewerId);
    this.reviewerAssignments.set(reviewerId, Math.max(0, currentWorkload + change));
  }

  /**
   * Update reviewer statistics
   * @param {number} reviewerId - Reviewer ID
   * @param {string} action - Review action
   * @param {Object} reviewItem - Review item
   */
  updateReviewerStats(reviewerId, action, reviewItem) {
    if (!this.reviewerStats.has(reviewerId)) {
      this.reviewerStats.set(reviewerId, {
        totalReviews: 0,
        approved: 0,
        rejected: 0,
        escalated: 0,
        avgReviewTime: 0,
        slaCompliance: 0
      });
    }

    const stats = this.reviewerStats.get(reviewerId);
    stats.totalReviews++;
    stats[action]++;

    if (reviewItem.metadata.reviewDuration) {
      stats.avgReviewTime = (
        (stats.avgReviewTime * (stats.totalReviews - 1)) + 
        reviewItem.metadata.reviewDuration
      ) / stats.totalReviews;
    }
  }

  /**
   * Calculate SLA deadline
   * @param {string} priority - Priority level
   * @returns {Date} SLA deadline
   */
  calculateSLADeadline(priority) {
    const slaMinutes = this.config.slaMinutes[priority] || 1440;
    const deadline = new Date();
    deadline.setMinutes(deadline.getMinutes() + slaMinutes);
    return deadline;
  }

  /**
   * Calculate escalation time
   * @param {string} priority - Priority level
   * @returns {Date} Escalation time
   */
  calculateEscalationTime(priority) {
    const escalationMinutes = this.config.escalation.thresholds[priority] || 2880;
    const escalationTime = new Date();
    escalationTime.setMinutes(escalationTime.getMinutes() + escalationMinutes);
    return escalationTime;
  }

  /**
   * Calculate review duration
   * @param {Object} reviewItem - Review item
   * @returns {number} Duration in milliseconds
   */
  calculateReviewDuration(reviewItem) {
    if (!reviewItem.assignedAt || !reviewItem.reviewCompleted) {
      return 0;
    }
    
    return new Date(reviewItem.reviewCompleted) - new Date(reviewItem.assignedAt);
  }

  /**
   * Get next priority level for escalation
   * @param {string} currentPriority - Current priority
   * @returns {string} Next priority level
   */
  getNextPriorityLevel(currentPriority) {
    const levels = ['low', 'medium', 'high', 'critical'];
    const currentIndex = levels.indexOf(currentPriority);
    return levels[Math.min(currentIndex + 1, levels.length - 1)];
  }

  /**
   * Get queue position for review item
   * @param {string} reviewId - Review ID
   * @returns {number} Queue position
   */
  getQueuePosition(reviewId) {
    const pendingItems = Array.from(this.reviewQueue.values())
      .filter(item => item.status === this.config.statuses.PENDING)
      .sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const aPriority = priorityOrder[a.priority] || 0;
        const bPriority = priorityOrder[b.priority] || 0;
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        
        return new Date(a.metadata.flaggedAt) - new Date(b.metadata.flaggedAt);
      });

    return pendingItems.findIndex(item => item.reviewId === reviewId) + 1;
  }

  /**
   * Estimate review time based on priority
   * @param {string} priority - Priority level
   * @returns {number} Estimated time in minutes
   */
  estimateReviewTime(priority) {
    const estimates = {
      critical: 15,
      high: 30,
      medium: 60,
      low: 120
    };
    
    return estimates[priority] || 60;
  }

  /**
   * Sanitize review data for storage
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   */
  sanitizeReviewData(data) {
    if (!data || typeof data !== 'object') return data;

    const sensitiveFields = ['password', 'token', 'secret', 'key', 'otp'];
    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Generate unique review ID
   * @returns {string} Review ID
   */
  generateReviewId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `review_${timestamp}_${random}`;
  }

  /**
   * Start escalation monitor
   */
  startEscalationMonitor() {
    if (!this.config.escalation.enabled) return;

    setInterval(() => {
      this.checkForEscalations();
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Start SLA monitor
   */
  startSLAMonitor() {
    setInterval(() => {
      this.checkSLAViolations();
    }, 10 * 60 * 1000); // Check every 10 minutes
  }

  /**
   * Check for items that need escalation
   */
  checkForEscalations() {
    const now = new Date();
    
    for (const [reviewId, item] of this.reviewQueue.entries()) {
      if (item.escalated) continue;
      
      const escalationTime = new Date(item.metadata.escalationTime);
      if (now > escalationTime) {
        console.log(`[Manual Review] Auto-escalating review ${reviewId} due to timeout`);
        
        item.escalated = true;
        item.escalationHistory.push({
          escalatedBy: 'system',
          escalatedAt: now.toISOString(),
          reason: 'Automatic escalation due to timeout',
          previousPriority: item.priority
        });
        
        item.priority = this.getNextPriorityLevel(item.priority);
        
        // Reset assignment for re-assignment with higher priority
        if (item.assignedReviewer) {
          this.updateReviewerWorkload(item.assignedReviewer, -1);
          item.assignedReviewer = null;
          item.assignedAt = null;
          item.status = this.config.statuses.PENDING;
        }
      }
    }
  }

  /**
   * Check for SLA violations
   */
  checkSLAViolations() {
    const now = new Date();
    
    for (const [reviewId, item] of this.reviewQueue.entries()) {
      const slaDeadline = new Date(item.metadata.slaDeadline);
      if (now > slaDeadline && item.status !== this.config.statuses.EXPIRED) {
        console.warn(`[Manual Review] SLA violation detected for review ${reviewId}`);
        
        // Mark as SLA violated but don't change status
        item.metadata.slaViolated = true;
        item.metadata.slaViolatedAt = now.toISOString();
      }
    }
  }

  /**
   * Get service statistics
   * @returns {Object} Service statistics
   */
  getServiceStatistics() {
    return {
      activeReviews: this.reviewQueue.size,
      completedReviews: this.reviewHistory.size,
      activeReviewers: this.reviewerAssignments.size,
      config: this.config
    };
  }
}

module.exports = ManualReviewService;