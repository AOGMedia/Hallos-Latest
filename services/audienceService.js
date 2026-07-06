'use strict';
const { Op } = require('sequelize');
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const NotificationPreference = require('../models/NotificationPreference');
const DigestQueue = require('../models/DigestQueue');
const NotificationLog = require('../models/NotificationLog');

/**
 * Audience Service
 *
 * Determines which users should receive notifications for a given live class/series.
 * Uses only existing data — no interest tracking needed.
 *
 * Audience = (past buyers/attendees of creator) UNION (newsletter subscribers)
 * Filtered by: preferences, deduplication, active accounts
 */
class AudienceService {

  /**
   * Get eligible audience for a live class or series notification.
   * @param {Object} content - LiveClass or LiveSeries instance
   * @param {string} contentType - 'live_class' | 'live_series'
   * @param {string} notificationType - 'instant' | 'daily' | 'weekly'
   * @returns {Promise<Array>} Array of user objects
   */
  async getAudience(content, contentType, notificationType) {
    try {
      const creatorId = content.userId;
      const contentId = content.id;

      // 1. Users who previously purchased/attended this creator's content
      const creatorAudienceIds = await this._getCreatorAudience(creatorId);

      // 2. Newsletter subscribers (broad fallback)
      const newsletterSubscribers = await User.findAll({
        where: { newsletterSubscribed: true },
        attributes: ['id']
      });
      const newsletterIds = newsletterSubscribers.map(u => u.id);

      // Merge and deduplicate
      const allUserIds = [...new Set([...creatorAudienceIds, ...newsletterIds])];

      if (allUserIds.length === 0) return [];

      // 3. Load users with their notification preferences
      const users = await User.findAll({
        where: { id: { [Op.in]: allUserIds } },
        attributes: ['id', 'email', 'firstname', 'lastname', 'newsletterSubscribed']
      });

      // 4. Load preferences for all these users in one query
      const prefs = await NotificationPreference.findAll({
        where: { userId: { [Op.in]: allUserIds } }
      });
      const prefsMap = {};
      prefs.forEach(p => { prefsMap[p.userId] = p; });

      // 5. Load already-notified users for this content (deduplication)
      const alreadyNotified = await NotificationLog.findAll({
        where: {
          contentId,
          notificationType: notificationType === 'instant' ? 'instant'
            : notificationType === 'daily' ? 'daily_digest' : 'weekly_digest'
        },
        attributes: ['userId']
      });
      const notifiedSet = new Set(alreadyNotified.map(n => n.userId));

      // 6. Filter audience
      const eligible = [];
      for (const user of users) {
        // Skip already notified
        if (notifiedSet.has(user.id)) continue;

        // Get preferences (use defaults if not set)
        const pref = prefsMap[user.id] || this._defaultPrefs();

        // Master kill switch
        if (pref.disableAllEmails) continue;

        // Check notification type preference
        if (notificationType === 'instant' && !pref.instantLiveClassEmails) continue;
        if (notificationType === 'daily' && !pref.dailyDigestEmails) continue;
        if (notificationType === 'weekly' && !pref.weeklyDigestEmails) continue;

        // If allowCreatorRelatedOnly, only include if they're in creator audience
        if (pref.allowCreatorRelatedOnly && !creatorAudienceIds.includes(user.id)) continue;

        eligible.push(user);
      }

      return eligible;
    } catch (error) {
      console.error('[Audience Service] getAudience error:', error);
      return [];
    }
  }

  /**
   * Queue digest items for a newly created live class/series.
   * Called when a creator creates content — does NOT send emails.
   */
  async queueDigestItems(content, contentType) {
    try {
      const audience = await this.getAudience(content, contentType, 'daily');
      if (audience.length === 0) return { queued: 0 };

      // Determine which digest types to queue for each user
      const creatorAudienceIds = await this._getCreatorAudience(content.userId);
      const prefs = await NotificationPreference.findAll({
        where: { userId: { [Op.in]: audience.map(u => u.id) } }
      });
      const prefsMap = {};
      prefs.forEach(p => { prefsMap[p.userId] = p; });

      const dailyItems = [];
      const weeklyItems = [];

      for (const user of audience) {
        const pref = prefsMap[user.id] || this._defaultPrefs();
        if (pref.disableAllEmails) continue;

        if (pref.dailyDigestEmails) {
          dailyItems.push({
            userId: user.id,
            contentType,
            contentId: content.id,
            digestType: 'daily',
            status: 'pending'
          });
        }

        if (pref.weeklyDigestEmails) {
          weeklyItems.push({
            userId: user.id,
            contentType,
            contentId: content.id,
            digestType: 'weekly',
            status: 'pending'
          });
        }
      }

      const allItems = [...dailyItems, ...weeklyItems];
      if (allItems.length === 0) return { queued: 0 };

      // Bulk insert — ignore duplicates (unique constraint handles it)
      let queued = 0;
      for (const item of allItems) {
        try {
          await DigestQueue.findOrCreate({
            where: {
              userId: item.userId,
              contentId: item.contentId,
              digestType: item.digestType
            },
            defaults: item
          });
          queued++;
        } catch (e) {
          // Duplicate — skip silently
        }
      }

      console.log(`[Audience Service] Queued ${queued} digest items for ${contentType} ${content.id}`);
      return { queued };
    } catch (error) {
      console.error('[Audience Service] queueDigestItems error:', error);
      return { queued: 0 };
    }
  }

  /**
   * Get users who previously purchased or attended this creator's content.
   */
  async _getCreatorAudience(creatorId) {
    try {
      const { LiveClass, LiveAttendee } = require('../models/liveIndex');
      const { LiveSeries } = require('../models/liveSeriesIndex');

      // Get all content IDs by this creator
      const [liveClasses, liveSeries] = await Promise.all([
        LiveClass.findAll({ where: { userId: creatorId }, attributes: ['id'] }),
        LiveSeries.findAll({ where: { userId: creatorId }, attributes: ['id'] })
      ]);

      const liveClassIds = liveClasses.map(c => c.id);
      const liveSeriesIds = liveSeries.map(s => s.id);
      const allContentIds = [...liveClassIds, ...liveSeriesIds];

      if (allContentIds.length === 0) return [];

      // Paid purchasers
      const purchases = await Purchase.findAll({
        where: {
          contentId: { [Op.in]: allContentIds },
          paymentStatus: 'completed'
        },
        attributes: ['userId']
      });

      // Free attendees of live classes
      let attendeeIds = [];
      if (liveClassIds.length > 0) {
        const attendees = await LiveAttendee.findAll({
          where: { liveClassId: { [Op.in]: liveClassIds } },
          attributes: ['userId']
        });
        attendeeIds = attendees.map(a => a.userId);
      }

      return [...new Set([
        ...purchases.map(p => p.userId),
        ...attendeeIds
      ])];
    } catch (error) {
      console.error('[Audience Service] _getCreatorAudience error:', error);
      return [];
    }
  }

  /**
   * Default preferences for users who haven't set theirs yet.
   */
  _defaultPrefs() {
    return {
      instantLiveClassEmails: false,
      dailyDigestEmails: true,
      weeklyDigestEmails: false,
      allowCreatorRelatedOnly: true,
      disableAllEmails: false
    };
  }
}

module.exports = new AudienceService();
