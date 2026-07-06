'use strict';
const { Op } = require('sequelize');
const User = require('../models/User');
const DigestQueue = require('../models/DigestQueue');
const NotificationLog = require('../models/NotificationLog');
const NotificationPreference = require('../models/NotificationPreference');

/**
 * Digest Service
 *
 * Processes daily and weekly digest emails.
 * Called by cron jobs — never called from request handlers.
 *
 * Flow:
 * 1. Find all pending digest_queue items of the given type
 * 2. Group by user
 * 3. For each user — check preferences, fetch live content data
 * 4. Filter out content that has already started or been deleted
 * 5. Send ONE email per user with all relevant items
 * 6. Mark queue items as sent, log to notification_logs
 */
class DigestService {

  /**
   * Process daily digest — call at 8am UTC daily
   */
  async processDailyDigest() {
    return this._processDigest('daily');
  }

  /**
   * Process weekly digest — call at 8am UTC every Monday
   */
  async processWeeklyDigest() {
    return this._processDigest('weekly');
  }

  async _processDigest(digestType) {
    console.log(`[Digest Service] Starting ${digestType} digest...`);
    const stats = { usersProcessed: 0, emailsSent: 0, emailsSkipped: 0, failed: 0 };

    try {
      // Get all pending items for this digest type
      const pendingItems = await DigestQueue.findAll({
        where: { digestType, status: 'pending' }
      });

      if (pendingItems.length === 0) {
        console.log(`[Digest Service] No pending ${digestType} digest items`);
        return stats;
      }

      // Group by user
      const byUser = {};
      for (const item of pendingItems) {
        if (!byUser[item.userId]) byUser[item.userId] = [];
        byUser[item.userId].push(item);
      }

      const userIds = Object.keys(byUser).map(Number);

      // Load users and preferences in bulk
      const [users, prefs] = await Promise.all([
        User.findAll({
          where: { id: { [Op.in]: userIds } },
          attributes: ['id', 'email', 'firstname', 'lastname']
        }),
        NotificationPreference.findAll({
          where: { userId: { [Op.in]: userIds } }
        })
      ]);

      const usersMap = {};
      users.forEach(u => { usersMap[u.id] = u; });

      const prefsMap = {};
      prefs.forEach(p => { prefsMap[p.userId] = p; });

      // Process each user
      for (const userId of userIds) {
        const user = usersMap[userId];
        if (!user) continue;

        const pref = prefsMap[userId] || this._defaultPrefs();
        const items = byUser[userId];

        stats.usersProcessed++;

        try {
          // Check preferences at send time
          if (pref.disableAllEmails) {
            await this._markItems(items, 'skipped');
            stats.emailsSkipped++;
            continue;
          }

          if (digestType === 'daily' && !pref.dailyDigestEmails) {
            await this._markItems(items, 'skipped');
            stats.emailsSkipped++;
            continue;
          }

          if (digestType === 'weekly' && !pref.weeklyDigestEmails) {
            await this._markItems(items, 'skipped');
            stats.emailsSkipped++;
            continue;
          }

          // Fetch live content data for each item
          const contentItems = await this._resolveContentItems(items);

          // Filter: only upcoming content (not started, not deleted)
          const now = new Date();
          const lookaheadDays = digestType === 'daily' ? 7 : 14;
          const lookahead = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

          const validItems = contentItems.filter(c =>
            c && c.startTime && new Date(c.startTime) > now && new Date(c.startTime) <= lookahead
          );

          if (validItems.length === 0) {
            // Nothing relevant — skip, don't send empty email
            await this._markItems(items, 'skipped');
            stats.emailsSkipped++;
            continue;
          }

          // Send digest email
          await this._sendDigestEmail(user, validItems, digestType);

          // Mark items as sent and log
          await this._markItems(items, 'sent');
          await this._logNotifications(userId, items, digestType);

          stats.emailsSent++;
        } catch (error) {
          console.error(`[Digest Service] Failed for user ${userId}:`, error.message);
          stats.failed++;
        }
      }

      console.log(`[Digest Service] ${digestType} digest complete:`, stats);
      return stats;
    } catch (error) {
      console.error(`[Digest Service] _processDigest error:`, error);
      return { ...stats, error: error.message };
    }
  }

  /**
   * Resolve content items from queue — fetch live data from DB
   */
  async _resolveContentItems(items) {
    const { LiveClass } = require('../models/liveIndex');
    const { LiveSeries } = require('../models/liveSeriesIndex');
    const User = require('../models/User');

    const results = [];

    for (const item of items) {
      try {
        let content = null;

        if (item.contentType === 'live_class') {
          content = await LiveClass.findByPk(item.contentId, {
            include: [{ model: User, as: 'creator', attributes: ['firstname', 'lastname'] }]
          });
          if (content) {
            results.push({
              id: content.id,
              title: content.title,
              creatorName: content.creator
                ? `${content.creator.firstname} ${content.creator.lastname}`.trim()
                : 'Creator',
              startTime: content.startTime,
              category: content.category,
              thumbnailUrl: content.thumbnailUrl,
              price: parseFloat(content.price),
              currency: content.currency,
              contentType: 'live_class',
              joinLink: `${process.env.CLIENT_URL}/live/${content.id}`
            });
          }
        } else if (item.contentType === 'live_series') {
          content = await LiveSeries.findByPk(item.contentId, {
            include: [{ model: User, as: 'creator', attributes: ['firstname', 'lastname'] }]
          });
          if (content) {
            results.push({
              id: content.id,
              title: content.title,
              creatorName: content.creator
                ? `${content.creator.firstname} ${content.creator.lastname}`.trim()
                : 'Creator',
              startTime: content.startDate,
              category: content.category,
              thumbnailUrl: content.thumbnailUrl,
              price: parseFloat(content.price),
              currency: content.currency,
              contentType: 'live_series',
              joinLink: `${process.env.CLIENT_URL}/live/series/${content.id}`
            });
          }
        }
      } catch (e) {
        // Content may have been deleted — skip silently
      }
    }

    return results;
  }

  /**
   * Send the digest email
   */
  async _sendDigestEmail(user, items, digestType) {
    const { sendDigestEmail } = require('../utils/email');
    await sendDigestEmail(user.email, user.firstname, items, digestType);
  }

  /**
   * Mark queue items with a status
   */
  async _markItems(items, status) {
    const ids = items.map(i => i.id);
    await DigestQueue.update({ status }, { where: { id: { [Op.in]: ids } } });
  }

  /**
   * Log sent notifications for deduplication
   */
  async _logNotifications(userId, items, digestType) {
    const notificationType = digestType === 'daily' ? 'daily_digest' : 'weekly_digest';
    for (const item of items) {
      try {
        await NotificationLog.findOrCreate({
          where: { userId, contentId: item.contentId, notificationType },
          defaults: {
            userId,
            contentType: item.contentType,
            contentId: item.contentId,
            notificationType,
            sentAt: new Date()
          }
        });
      } catch (e) {
        // Duplicate log — ignore
      }
    }
  }

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

module.exports = new DigestService();