'use strict';
const NotificationPreference = require('../models/NotificationPreference');
const DigestQueue = require('../models/DigestQueue');
const NotificationLog = require('../models/NotificationLog');

const DEFAULT_PREFS = {
  instantLiveClassEmails: false,
  dailyDigestEmails: true,
  weeklyDigestEmails: false,
  allowCreatorRelatedOnly: true,
  disableAllEmails: false
};

/**
 * GET /api/notifications/preferences
 * Returns the user's notification preferences (creates defaults if not set)
 */
exports.getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;

    let prefs = await NotificationPreference.findOne({ where: { userId } });

    if (!prefs) {
      // Return defaults without creating a DB row yet
      return res.json({ success: true, data: { userId, ...DEFAULT_PREFS } });
    }

    return res.json({ success: true, data: prefs });
  } catch (error) {
    console.error('[Notification Prefs] getPreferences error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch preferences' });
  }
};

/**
 * PATCH /api/notifications/preferences
 * Update notification preferences with validation
 */
exports.updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      instantLiveClassEmails,
      dailyDigestEmails,
      weeklyDigestEmails,
      allowCreatorRelatedOnly,
      disableAllEmails
    } = req.body;

    // Build update object — only include fields that were sent
    const updates = {};
    if (typeof instantLiveClassEmails === 'boolean') updates.instantLiveClassEmails = instantLiveClassEmails;
    if (typeof dailyDigestEmails === 'boolean') updates.dailyDigestEmails = dailyDigestEmails;
    if (typeof weeklyDigestEmails === 'boolean') updates.weeklyDigestEmails = weeklyDigestEmails;
    if (typeof allowCreatorRelatedOnly === 'boolean') updates.allowCreatorRelatedOnly = allowCreatorRelatedOnly;
    if (typeof disableAllEmails === 'boolean') updates.disableAllEmails = disableAllEmails;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid preference fields provided' });
    }

    // Get current prefs to validate the combined state
    const existing = await NotificationPreference.findOne({ where: { userId } });
    const current = existing ? existing.toJSON() : { ...DEFAULT_PREFS };
    const merged = { ...current, ...updates };

    // Rule: if disableAllEmails is false, user must have at least one delivery method enabled
    if (!merged.disableAllEmails) {
      const hasAnyEnabled = merged.instantLiveClassEmails || merged.dailyDigestEmails || merged.weeklyDigestEmails;
      if (!hasAnyEnabled) {
        return res.status(400).json({
          success: false,
          message: 'You must have at least one notification method enabled (instant, daily digest, or weekly digest), or disable all emails.'
        });
      }
    }

    // Upsert preferences
    const [prefs] = await NotificationPreference.findOrCreate({
      where: { userId },
      defaults: { userId, ...DEFAULT_PREFS }
    });

    await prefs.update(updates);

    return res.json({ success: true, data: prefs });
  } catch (error) {
    console.error('[Notification Prefs] updatePreferences error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update preferences' });
  }
};

/**
 * GET /api/notifications/digest-queue
 * Admin: view pending digest queue items
 */
exports.getDigestQueue = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || 'pending';

    const { count, rows } = await DigestQueue.findAndCountAll({
      where: { status },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    return res.json({ success: true, data: { total: count, page, limit, items: rows } });
  } catch (error) {
    console.error('[Notification Prefs] getDigestQueue error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch digest queue' });
  }
};

/**
 * GET /api/notifications/logs
 * Admin: view notification logs
 */
exports.getNotificationLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const VALID_NOTIFICATION_TYPES = ['instant', 'daily_digest', 'weekly_digest', 'reminder'];

    const where = {};
    if (req.query.userId) where.userId = parseInt(req.query.userId);
    if (req.query.notificationType) {
      if (!VALID_NOTIFICATION_TYPES.includes(req.query.notificationType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid notificationType. Must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}`
        });
      }
      where.notificationType = req.query.notificationType;
    }
    if (req.query.contentType) where.contentType = req.query.contentType;

    const { count, rows } = await NotificationLog.findAndCountAll({
      where,
      order: [['sentAt', 'DESC']],
      limit,
      offset
    });

    return res.json({ success: true, data: { total: count, page, limit, logs: rows } });
  } catch (error) {
    console.error('[Notification Prefs] getNotificationLogs error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch logs' });
  }
};

/**
 * POST /api/notifications/digest/trigger
 * Admin: manually trigger a digest run (for testing)
 */
exports.triggerDigest = async (req, res) => {
  try {
    const { type } = req.body;
    if (!['daily', 'weekly'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be daily or weekly' });
    }

    const digestService = require('../services/digestService');
    const result = type === 'daily'
      ? await digestService.processDailyDigest()
      : await digestService.processWeeklyDigest();

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Notification Prefs] triggerDigest error:', error);
    return res.status(500).json({ success: false, message: 'Failed to trigger digest' });
  }
};
