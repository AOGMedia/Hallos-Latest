const { LiveSession, LiveSeries } = require('../models/liveSeriesIndex');
const { LiveClass, LiveAttendee } = require('../models/liveIndex');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const { Op } = require('sequelize');

/**
 * Notification Service
 * 
 * Handles all notification logic:
 * - Live session reminders
 * - Newsletter notifications for new content
 * - Email sending with templates
 */

class NotificationService {
  constructor() {
    this.enabled = process.env.NOTIFICATIONS_ENABLED === 'true';
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Find sessions that need reminders (1 hour before start)
   * @returns {Promise<Array>} Sessions needing reminders
   */
  async findSessionsNeedingReminders() {
    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const oneHourFifteenMinsFromNow = new Date(now.getTime() + 75 * 60 * 1000);

      // Find sessions starting in 1 hour (with 15 min buffer)
      const sessions = await LiveSession.findAll({
        where: {
          status: 'scheduled',
          reminderSent: false,
          scheduledStartTime: {
            [Op.gte]: oneHourFromNow,
            [Op.lte]: oneHourFifteenMinsFromNow
          }
        },
        include: [{
          model: LiveSeries,
          as: 'series',
          attributes: ['id', 'title', 'userId', 'thumbnailUrl']
        }]
      });

      console.log(`[Notification Service] Found ${sessions.length} sessions needing reminders`);
      return sessions;
    } catch (error) {
      console.error('[Notification Service] Find sessions error:', error);
      return [];
    }
  }

  /**
   * Get enrolled students for a series (paid + free registrations)
   * @param {string} seriesId - Series ID
   * @returns {Promise<Array>} Array of user objects
   */
  async getEnrolledStudents(seriesId) {
    try {
      // Paid students — from Purchase table
      const purchases = await Purchase.findAll({
        where: {
          contentType: 'live_series',
          contentId: seriesId,
          paymentStatus: 'completed'
        },
        attributes: ['userId']
      });

      // Free registrants — from LiveSeriesRegistration table
      let freeUserIds = [];
      try {
        const LiveSeriesRegistration = require('../models/LiveSeriesRegistration');
        const freeRegs = await LiveSeriesRegistration.findAll({
          where: { seriesId },
          attributes: ['userId']
        });
        freeUserIds = freeRegs.map(r => r.userId);
      } catch (e) {
        // Table may not exist yet if migration hasn't run — non-fatal
        console.warn('[Notification Service] LiveSeriesRegistration table not available:', e.message);
      }

      // Merge and deduplicate user IDs
      const paidUserIds = purchases.map(p => p.userId);
      const allUserIds = [...new Set([...paidUserIds, ...freeUserIds])];

      if (allUserIds.length === 0) return [];

      const users = await User.findAll({
        where: { id: { [Op.in]: allUserIds } },
        attributes: ['id', 'email', 'firstname', 'lastname']
      });

      return users;
    } catch (error) {
      console.error('[Notification Service] Get enrolled students error:', error);
      return [];
    }
  }

  /**
   * Send session reminder to a student
   * @param {Object} user - User object
   * @param {Object} session - Session object
   * @returns {Promise<boolean>} Success status
   */
  async sendSessionReminder(user, session) {
    try {
      const { sendSessionReminderEmail } = require('../utils/email');
      
      const sessionData = {
        sessionId: session.id,
        seriesId: session.seriesId, // Add seriesId for the join link
        sessionNumber: session.sessionNumber,
        seriesTitle: session.series.title,
        scheduledStartTime: session.scheduledStartTime,
        scheduledEndTime: session.scheduledEndTime,
        thumbnailUrl: session.series.thumbnailUrl
      };

      await sendSessionReminderEmail(
        user.email,
        user.firstname,
        sessionData
      );

      console.log(`[Notification Service] Sent reminder to ${user.email} for session ${session.id}`);
      return true;
    } catch (error) {
      console.error(`[Notification Service] Failed to send reminder to ${user.email}:`, error);
      return false;
    }
  }

  /**
   * Find live classes that need reminders (1 hour before start)
   */
  async findLiveClassesNeedingReminders() {
    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const oneHourFifteenMinsFromNow = new Date(now.getTime() + 75 * 60 * 1000);

      const classes = await LiveClass.findAll({
        where: {
          status: 'scheduled',
          startTime: {
            [Op.gte]: oneHourFromNow,
            [Op.lte]: oneHourFifteenMinsFromNow
          }
        }
      });

      return classes;
    } catch (error) {
      console.error('[Notification Service] Find live classes error:', error);
      return [];
    }
  }

  /**
   * Get all registered students for a live class (free + paid)
   */
  async getLiveClassStudents(liveClassId) {
    try {
      // Free registrants
      const freeAttendees = await LiveAttendee.findAll({
        where: { liveClassId, statusPaid: false },
        attributes: ['userId']
      });

      // Paid purchasers
      const paidPurchases = await Purchase.findAll({
        where: { contentType: 'live_class', contentId: liveClassId, paymentStatus: 'completed' },
        attributes: ['userId']
      });

      const allUserIds = [...new Set([
        ...freeAttendees.map(a => a.userId),
        ...paidPurchases.map(p => p.userId)
      ])];

      if (allUserIds.length === 0) return [];

      return User.findAll({
        where: { id: { [Op.in]: allUserIds } },
        attributes: ['id', 'email', 'firstname', 'lastname']
      });
    } catch (error) {
      console.error('[Notification Service] Get live class students error:', error);
      return [];
    }
  }

  /**
   * Process session reminders (called by cron job)
   * @returns {Promise<Object>} Processing results
   */
  async processSessionReminders() {
    if (!this.isEnabled()) {
      console.log('[Notification Service] Notifications disabled - skipping');
      return { processed: 0, sent: 0, failed: 0 };
    }

    try {
      console.log('[Notification Service] Processing session reminders...');

      const sessions = await this.findSessionsNeedingReminders();
      const liveClasses = await this.findLiveClassesNeedingReminders();
      let totalSent = 0;
      let totalFailed = 0;

      // Process live series session reminders
      for (const session of sessions) {
        try {
          const students = await this.getEnrolledStudents(session.seriesId);
          console.log(`[Notification Service] Sending reminders for session ${session.id} to ${students.length} students`);

          const results = await Promise.allSettled(
            students.map(student => this.sendSessionReminder(student, session))
          );

          const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
          const failed = results.filter(r => r.status === 'rejected' || r.value === false).length;

          totalSent += sent;
          totalFailed += failed;

          await session.update({ reminderSent: true });
          console.log(`[Notification Service] Session ${session.id}: ${sent} sent, ${failed} failed`);
        } catch (error) {
          console.error(`[Notification Service] Error processing session ${session.id}:`, error);
          totalFailed++;
        }
      }

      // Process live class reminders
      for (const liveClass of liveClasses) {
        try {
          const students = await this.getLiveClassStudents(liveClass.id);
          console.log(`[Notification Service] Sending reminders for live class ${liveClass.id} to ${students.length} students`);

          // Build a session-like object for the email template
          const sessionLike = {
            id: liveClass.id,
            seriesId: null,
            sessionNumber: 1,
            series: { title: liveClass.title, thumbnailUrl: liveClass.thumbnailUrl },
            scheduledStartTime: liveClass.startTime,
            scheduledEndTime: liveClass.endTime
          };

          const results = await Promise.allSettled(
            students.map(student => this.sendSessionReminder(student, sessionLike))
          );

          const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
          const failed = results.filter(r => r.status === 'rejected' || r.value === false).length;

          totalSent += sent;
          totalFailed += failed;
          console.log(`[Notification Service] Live class ${liveClass.id}: ${sent} sent, ${failed} failed`);
        } catch (error) {
          console.error(`[Notification Service] Error processing live class ${liveClass.id}:`, error);
          totalFailed++;
        }
      }

      const result = {
        processed: sessions.length + liveClasses.length,
        sent: totalSent,
        failed: totalFailed,
        timestamp: new Date()
      };

      console.log('[Notification Service] Reminder processing complete:', result);
      return result;
    } catch (error) {
      console.error('[Notification Service] Process reminders error:', error);
      return { processed: 0, sent: 0, failed: 0, error: error.message };
    }
  }

  /**
   * Get newsletter subscribers
   * @returns {Promise<Array>} Array of subscribed users
   */
  async getNewsletterSubscribers() {
    try {
      const subscribers = await User.findAll({
        where: {
          newsletterSubscribed: true
        },
        attributes: ['id', 'email', 'firstname', 'lastname']
      });

      console.log(`[Notification Service] Found ${subscribers.length} newsletter subscribers`);
      return subscribers;
    } catch (error) {
      console.error('[Notification Service] Get subscribers error:', error);
      return [];
    }
  }

  /**
   * Send new content notification to subscribers
   * @param {Object} content - Content object (video, live_class, live_series)
   * @param {string} contentType - Type of content
   * @returns {Promise<Object>} Sending results
   */
  async notifyNewContent(content, contentType) {
    if (!this.isEnabled()) {
      console.log('[Notification Service] Notifications disabled - skipping');
      return { sent: 0, failed: 0 };
    }

    try {
      console.log(`[Notification Service] Notifying subscribers about new ${contentType}`);

      const subscribers = await this.getNewsletterSubscribers();
      const { sendNewContentEmail } = require('../utils/email');

      const contentData = {
        id: content.id,
        title: content.title,
        description: content.description,
        thumbnailUrl: content.thumbnailUrl,
        price: content.price,
        currency: content.currency,
        contentType,
        pricing: content.getDualPricing ? content.getDualPricing() : null
      };

      // Get creator info
      const creator = await User.findByPk(content.userId, {
        attributes: ['firstname', 'lastname']
      });

      if (creator) {
        contentData.creatorName = `${creator.firstname} ${creator.lastname}`.trim();
      }

      // Send emails in batches to avoid overwhelming the email server
      const batchSize = 50;
      let sent = 0;
      let failed = 0;

      for (let i = 0; i < subscribers.length; i += batchSize) {
        const batch = subscribers.slice(i, i + batchSize);
        
        const results = await Promise.allSettled(
          batch.map(subscriber => 
            sendNewContentEmail(subscriber.email, subscriber.firstname, contentData)
          )
        );

        sent += results.filter(r => r.status === 'fulfilled').length;
        failed += results.filter(r => r.status === 'rejected').length;

        // Small delay between batches
        if (i + batchSize < subscribers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`[Notification Service] New content notification: ${sent} sent, ${failed} failed`);
      return { sent, failed };
    } catch (error) {
      console.error('[Notification Service] Notify new content error:', error);
      return { sent: 0, failed: 0, error: error.message };
    }
  }
}

module.exports = NotificationService;
