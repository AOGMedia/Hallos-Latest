const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { LiveClass } = require('../models/liveIndex');

/**
 * Live Class Cleanup Service
 * 
 * Handles automatic cleanup and status management for live classes:
 * - Auto-ends stale "live" classes that have been running too long
 * - Cleans up old ended classes for better performance
 * - Manages class lifecycle transitions
 * 
 * Designed to run as background cron jobs
 */

class LiveClassCleanupService {
  constructor() {
    this.config = {
      // Auto-end classes that have been "live" for more than X hours
      staleThresholdHours: 6,
      
      // Archive classes that ended more than X days ago
      archiveThresholdDays: 30,
      
      // Maximum classes to process in one batch (performance)
      batchSize: 100
    };
  }

  /**
   * Auto-end classes that have been "live" for too long
   * This handles cases where:
   * - ZegoCloud sessions didn't properly end
   * - Mux webhooks were missed
   * - Creators forgot to end their streams
   */
  async autoEndStaleLiveClasses() {
    try {
      const cutoffTime = new Date(Date.now() - (this.config.staleThresholdHours * 60 * 60 * 1000));
      
      console.log(`🧹 [Cleanup] Checking for live classes older than ${this.config.staleThresholdHours} hours...`);

      // Find classes that have been "live" for too long
      const staleClasses = await LiveClass.findAll({
        where: {
          status: 'live',
          updatedAt: { [Op.lt]: cutoffTime }
        },
        limit: this.config.batchSize,
        attributes: ['id', 'title', 'userId', 'streaming_provider', 'updatedAt']
      });

      if (staleClasses.length === 0) {
        console.log('✅ [Cleanup] No stale live classes found');
        return { endedCount: 0, errors: [] };
      }

      console.log(`🔄 [Cleanup] Found ${staleClasses.length} stale live classes, ending them...`);

      let endedCount = 0;
      const errors = [];

      // Auto-end each stale class
      for (const liveClass of staleClasses) {
        try {
          await liveClass.update({ 
            status: 'ended',
            endTime: new Date()
          });

          console.log(`✅ [Cleanup] Auto-ended: "${liveClass.title}" (${liveClass.streaming_provider})`);
          endedCount++;
        } catch (error) {
          console.error(`❌ [Cleanup] Failed to end class ${liveClass.id}:`, error.message);
          errors.push({
            classId: liveClass.id,
            title: liveClass.title,
            error: error.message
          });
        }
      }

      console.log(`🎉 [Cleanup] Auto-ended ${endedCount} stale live classes`);
      
      return {
        endedCount,
        errors,
        processedAt: new Date()
      };

    } catch (error) {
      console.error('❌ [Cleanup] Auto-end stale classes failed:', error);
      throw error;
    }
  }

  /**
   * Auto-end sessions that have been "live" for too long
   * Separate from one-time classes for safety
   */
  async autoEndStaleSessions() {
    try {
      const { LiveSession } = require('../models/liveSeriesIndex');
      const cutoffTime = new Date(Date.now() - (this.config.staleThresholdHours * 60 * 60 * 1000));
      
      console.log(`🧹 [Cleanup] Checking for live sessions older than ${this.config.staleThresholdHours} hours...`);

      // Find sessions that have been "live" for too long
      const staleSessions = await LiveSession.findAll({
        where: {
          status: 'live',
          updatedAt: { [Op.lt]: cutoffTime }
        },
        limit: this.config.batchSize,
        attributes: ['id', 'sessionNumber', 'seriesId', 'updatedAt']
      });

      if (staleSessions.length === 0) {
        console.log('✅ [Cleanup] No stale live sessions found');
        return { endedCount: 0, errors: [] };
      }

      console.log(`🔄 [Cleanup] Found ${staleSessions.length} stale live sessions, ending them...`);

      let endedCount = 0;
      const errors = [];

      // Auto-end each stale session
      for (const session of staleSessions) {
        try {
          await session.update({ 
            status: 'ended',
            actualEndTime: new Date()
          });

          console.log(`✅ [Cleanup] Auto-ended session ${session.sessionNumber} in series ${session.seriesId}`);
          endedCount++;
        } catch (error) {
          console.error(`❌ [Cleanup] Failed to end session ${session.id}:`, error.message);
          errors.push({
            sessionId: session.id,
            seriesId: session.seriesId,
            error: error.message
          });
        }
      }

      console.log(`🎉 [Cleanup] Auto-ended ${endedCount} stale live sessions`);
      
      return {
        endedCount,
        errors,
        processedAt: new Date()
      };

    } catch (error) {
      console.error('❌ [Cleanup] Auto-end stale sessions failed:', error);
      throw error;
    }
  }

  /**
   * Archive old ended classes to improve performance
   * Options: Delete, move to archive table, or mark as archived
   */
  async archiveOldEndedClasses() {
    try {
      const cutoffTime = new Date(Date.now() - (this.config.archiveThresholdDays * 24 * 60 * 60 * 1000));
      
      console.log(`🗄️ [Archive] Checking for ended classes older than ${this.config.archiveThresholdDays} days...`);

      // Find old ended classes
      const oldClasses = await LiveClass.findAll({
        where: {
          status: 'ended',
          endTime: { [Op.lt]: cutoffTime }
        },
        limit: this.config.batchSize,
        attributes: ['id', 'title', 'endTime']
      });

      if (oldClasses.length === 0) {
        console.log('✅ [Archive] No old ended classes found');
        return { archivedCount: 0, errors: [] };
      }

      console.log(`🔄 [Archive] Found ${oldClasses.length} old ended classes`);

      // Option 1: Add "archived" status (recommended - keeps data)
      let archivedCount = 0;
      const errors = [];

      for (const liveClass of oldClasses) {
        try {
          // Add archived status to enum if not exists, or use a flag
          await liveClass.update({ 
            status: 'archived' // You might need to add this to the enum
            // Or use: archived: true (add this field to model)
          });

          console.log(`📦 [Archive] Archived: "${liveClass.title}"`);
          archivedCount++;
        } catch (error) {
          console.error(`❌ [Archive] Failed to archive class ${liveClass.id}:`, error.message);
          errors.push({
            classId: liveClass.id,
            title: liveClass.title,
            error: error.message
          });
        }
      }

      console.log(`🎉 [Archive] Archived ${archivedCount} old classes`);
      
      return {
        archivedCount,
        errors,
        processedAt: new Date()
      };

    } catch (error) {
      console.error('❌ [Archive] Archive old classes failed:', error);
      throw error;
    }
  }

  /**
   * One-time cleanup: End all currently stale live classes
   * Use this for initial cleanup of existing data
   */
  async oneTimeCleanup() {
    try {
      console.log('🚀 [One-Time Cleanup] Starting comprehensive cleanup...');

      // End all stale live classes (regardless of age)
      const allLiveClasses = await LiveClass.findAll({
        where: { status: 'live' },
        attributes: ['id', 'title', 'createdAt', 'updatedAt', 'streaming_provider']
      });

      console.log(`📊 [One-Time Cleanup] Found ${allLiveClasses.length} live classes`);

      let endedCount = 0;
      const now = new Date();

      for (const liveClass of allLiveClasses) {
        // Check if class has been live for more than 1 hour (reasonable threshold)
        const hoursSinceLive = (now - new Date(liveClass.updatedAt)) / (1000 * 60 * 60);
        
        if (hoursSinceLive > 1) {
          await liveClass.update({ 
            status: 'ended',
            endTime: now
          });
          
          console.log(`✅ [One-Time Cleanup] Ended: "${liveClass.title}" (live for ${hoursSinceLive.toFixed(1)}h)`);
          endedCount++;
        }
      }

      console.log(`🎉 [One-Time Cleanup] Ended ${endedCount} stale classes out of ${allLiveClasses.length} total`);
      
      return {
        totalLiveClasses: allLiveClasses.length,
        endedCount,
        processedAt: now
      };

    } catch (error) {
      console.error('❌ [One-Time Cleanup] Failed:', error);
      throw error;
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats() {
    try {
      const stats = await LiveClass.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['status'],
        raw: true
      });

      const statusCounts = {};
      stats.forEach(stat => {
        statusCounts[stat.status] = parseInt(stat.count);
      });

      return {
        statusCounts,
        totalClasses: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
        generatedAt: new Date()
      };
    } catch (error) {
      console.error('❌ [Cleanup Stats] Failed:', error);
      throw error;
    }
  }
}

module.exports = LiveClassCleanupService;