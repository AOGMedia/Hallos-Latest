const { LiveSeries, LiveSession } = require('../models/liveSeriesIndex');
const Purchase = require('../models/Purchase');
const sequelize = require('../config/db');
const { Op } = require('sequelize');

/** An error the controller turns into a 4xx with this message. */
const scheduleError = (code, message) => Object.assign(new Error(message), { code });

/** A session somebody actually ran (or is running): never moved or renumbered. */
const wasHeld = (session) =>
  session.status === 'ended' || session.status === 'live' || !!session.actualStartTime;

/** Server-local calendar day — the unit sessions are generated on. */
const localDayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * Live Series Service
 * Handles business logic for recurring live class series
 */

class LiveSeriesService {
  
  /**
   * Generate session schedule based on recurrence pattern
   * @param {Object} series - LiveSeries instance
   * @returns {Array} Array of session objects
   */
  generateSessionSchedule(series) {
    const sessions = [];
    const { days, startTime, duration } = series.recurrencePattern;
    
    console.log('[Live Series Service] Generating sessions with:', {
      days,
      startTime,
      duration,
      startDate: series.startDate,
      endDate: series.endDate
    });
    
    // Map day names to day numbers (0 = Sunday, 1 = Monday, etc.)
    const dayMap = {
      'sunday': 0,
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6
    };
    
    const dayNumbers = days.map(day => dayMap[day.toLowerCase()]);
    console.log('[Live Series Service] Looking for day numbers:', dayNumbers);
    
    // Parse start time (format: "19:00")
    const [hours, minutes] = startTime.split(':').map(Number);
    
    // Iterate through date range
    const currentDate = new Date(series.startDate);
    const endDate = new Date(series.endDate);
    let sessionNumber = 1;
    
    console.log('[Live Series Service] Date range:', {
      start: currentDate.toISOString(),
      end: endDate.toISOString()
    });
    
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      
      // Check if this day matches the recurrence pattern
      if (dayNumbers.includes(dayOfWeek)) {
        // Create session start time
        const sessionStart = new Date(currentDate);
        sessionStart.setHours(hours, minutes, 0, 0);
        
        // Create session end time
        const sessionEnd = new Date(sessionStart);
        sessionEnd.setMinutes(sessionEnd.getMinutes() + duration);
        
        sessions.push({
          seriesId: series.id,
          sessionNumber: sessionNumber++,
          scheduledStartTime: sessionStart,
          scheduledEndTime: sessionEnd,
          status: 'scheduled'
        });
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log('[Live Series Service] Generated sessions count:', sessions.length);
    
    return sessions;
  }
  
  /**
   * Create sessions for a series
   * @param {Object} series - LiveSeries instance
   * @returns {Promise<Array>} Created session records
   */
  async createSessionsForSeries(series) {
    try {
      const sessionData = this.generateSessionSchedule(series);
      
      if (sessionData.length === 0) {
        throw new Error('No sessions generated. Check recurrence pattern and date range.');
      }
      
      const sessions = await LiveSession.bulkCreate(sessionData);
      
      console.log(`[Live Series Service] Created ${sessions.length} sessions for series ${series.id}`);
      
      return sessions;
    } catch (error) {
      console.error('[Live Series Service] Error creating sessions:', error);
      throw error;
    }
  }
  
  /**
   * Check if user has purchased access to a series
   * @param {number} userId - User ID
   * @param {string} seriesId - Series ID
   * @returns {Promise<boolean>} True if user has access
   */
  async checkSeriesAccess(userId, seriesId) {
    try {
      // Check if user is the creator
      const series = await LiveSeries.findByPk(seriesId);
      if (!series) {
        return false;
      }
      
      if (series.userId === userId) {
        return true;
      }
      
      // Check if series is free (price = 0)
      const price = parseFloat(series.price);
      if (price === 0) {
        return true;
      }
      
      // Check if user purchased the series
      const purchase = await Purchase.findOne({
        where: {
          userId,
          contentType: 'live_series',
          contentId: seriesId,
          paymentStatus: 'completed'
        }
      });
      
      return !!purchase;
    } catch (error) {
      console.error('[Live Series Service] Error checking access:', error);
      return false;
    }
  }
  
  /**
   * Get next scheduled session for a series
   * @param {string} seriesId - Series ID
   * @returns {Promise<Object|null>} Next session or null
   */
  async getNextSession(seriesId) {
    try {
      const now = new Date();
      
      const nextSession = await LiveSession.findOne({
        where: {
          seriesId,
          status: 'scheduled',
          scheduledStartTime: {
            [Op.gte]: now
          }
        },
        order: [['scheduledStartTime', 'ASC']]
      });
      
      return nextSession;
    } catch (error) {
      console.error('[Live Series Service] Error getting next session:', error);
      return null;
    }
  }
  
  /**
   * Get currently active (live) session for a series
   * @param {string} seriesId - Series ID
   * @returns {Promise<Object|null>} Active session or null
   */
  async getActiveSession(seriesId) {
    try {
      const activeSession = await LiveSession.findOne({
        where: {
          seriesId,
          status: 'live'
        }
      });
      
      return activeSession;
    } catch (error) {
      console.error('[Live Series Service] Error getting active session:', error);
      return null;
    }
  }
  
  /**
   * Get all sessions for a series with filtering
   * @param {string} seriesId - Series ID
   * @param {Object} filters - Optional filters (status, upcoming, past)
   * @returns {Promise<Array>} Array of sessions
   */
  async getSeriesSessions(seriesId, filters = {}) {
    try {
      const where = { seriesId };
      
      if (filters.status) {
        where.status = filters.status;
      }
      
      if (filters.upcoming) {
        where.scheduledStartTime = {
          [Op.gte]: new Date()
        };
        where.status = 'scheduled';
      }
      
      if (filters.past) {
        where.scheduledEndTime = {
          [Op.lt]: new Date()
        };
      }
      
      const sessions = await LiveSession.findAll({
        where,
        order: [['sessionNumber', 'ASC']],
        include: [{
          model: LiveSeries,
          as: 'series',
          attributes: ['id', 'title', 'userId']
        }]
      });
      
      return sessions;
    } catch (error) {
      console.error('[Live Series Service] Error getting sessions:', error);
      throw error;
    }
  }
  
  /**
   * Calculate series statistics
   * @param {string} seriesId - Series ID
   * @returns {Promise<Object>} Statistics object
   */
  async calculateSeriesStats(seriesId) {
    try {
      const sessions = await LiveSession.findAll({
        where: { seriesId }
      });
      
      const totalSessions = sessions.length;
      const completedSessions = sessions.filter(s => s.status === 'ended').length;
      const liveSessions = sessions.filter(s => s.status === 'live').length;
      const scheduledSessions = sessions.filter(s => s.status === 'scheduled').length;
      const cancelledSessions = sessions.filter(s => s.status === 'cancelled').length;
      
      // Calculate completion percentage
      const completionPercentage = totalSessions > 0 
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0;
      
      // Get next session
      const nextSession = await this.getNextSession(seriesId);
      
      // Get active session
      const activeSession = await this.getActiveSession(seriesId);
      
      return {
        totalSessions,
        completedSessions,
        liveSessions,
        scheduledSessions,
        cancelledSessions,
        completionPercentage,
        nextSession: nextSession ? {
          id: nextSession.id,
          sessionNumber: nextSession.sessionNumber,
          scheduledStartTime: nextSession.scheduledStartTime
        } : null,
        activeSession: activeSession ? {
          id: activeSession.id,
          sessionNumber: activeSession.sessionNumber,
          zegoRoomId: activeSession.zegoRoomId
        } : null
      };
    } catch (error) {
      console.error('[Live Series Service] Error calculating stats:', error);
      throw error;
    }
  }
  
  /**
   * Check if series can be cancelled
   * @param {Object} series - LiveSeries instance
   * @returns {Object} { canCancel: boolean, reason: string }
   */
  canCancelSeries(series) {
    if (series.status === 'cancelled') {
      return { canCancel: false, reason: 'Series is already cancelled' };
    }
    
    if (series.status === 'completed') {
      return { canCancel: false, reason: 'Series is already completed' };
    }
    
    return { canCancel: true, reason: null };
  }
  
  /**
   * Extend series by generating additional sessions for new end date
   * @param {Object} series - LiveSeries instance
   * @param {Date} newEndDate - New end date
   * @returns {Promise<Array>} Array of newly created sessions
   */
  async extendSeriesSessions(series, newEndDate) {
    try {
      // Get the last session number
      const lastSession = await LiveSession.findOne({
        where: { seriesId: series.id },
        order: [['sessionNumber', 'DESC']]
      });
      
      const lastSessionNumber = lastSession ? lastSession.sessionNumber : 0;
      const lastSessionDate = lastSession 
        ? new Date(lastSession.scheduledEndTime)
        : new Date(series.startDate);
      
      console.log('[Live Series Service] Extending sessions from:', {
        lastSessionNumber,
        lastSessionDate: lastSessionDate.toISOString(),
        newEndDate: newEndDate.toISOString()
      });
      
      // Generate sessions for the extended period
      const { days, startTime, duration } = series.recurrencePattern;
      
      // Map day names to day numbers
      const dayMap = {
        'sunday': 0,
        'monday': 1,
        'tuesday': 2,
        'wednesday': 3,
        'thursday': 4,
        'friday': 5,
        'saturday': 6
      };
      
      const dayNumbers = days.map(day => dayMap[day.toLowerCase()]);
      const [hours, minutes] = startTime.split(':').map(Number);
      
      // Start from the day after the last session
      const currentDate = new Date(lastSessionDate);
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
      
      const sessions = [];
      let sessionNumber = lastSessionNumber + 1;
      
      while (currentDate <= newEndDate) {
        const dayOfWeek = currentDate.getDay();
        
        if (dayNumbers.includes(dayOfWeek)) {
          const sessionStart = new Date(currentDate);
          sessionStart.setHours(hours, minutes, 0, 0);
          
          const sessionEnd = new Date(sessionStart);
          sessionEnd.setMinutes(sessionEnd.getMinutes() + duration);
          
          sessions.push({
            seriesId: series.id,
            sessionNumber: sessionNumber++,
            scheduledStartTime: sessionStart,
            scheduledEndTime: sessionEnd,
            status: 'scheduled'
          });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      if (sessions.length > 0) {
        const createdSessions = await LiveSession.bulkCreate(sessions);
        console.log(`[Live Series Service] Created ${createdSessions.length} additional sessions`);
        return createdSessions;
      }
      
      return [];
    } catch (error) {
      console.error('[Live Series Service] Error extending sessions:', error);
      throw error;
    }
  }
  
  /**
   * Move a series to new days, a new start time and/or a new start date.
   *
   * Only sessions that haven't happened are touched:
   *  - Not started yet (no session has run): every scheduled session is
   *    replaced, so a new start date can move the whole series.
   *  - Already started: sessions that ran, are live or are in the past stay as
   *    they are; the scheduled ones still to come are replaced.
   *
   * Replaced sessions keep their ids, in order, so join links creators have
   * shared (/live/join/<sessionId>) still open the next classes. Extra
   * sessions are added and leftover ones removed. Upcoming sessions are
   * numbered on from the last kept one, and a session whose time changed gets
   * its 1-hour reminder again.
   *
   * Everything (sessions and the series' own fields) is written in one
   * transaction, under the same per-series lock that guards session creation.
   *
   * @param {Object} series - LiveSeries instance
   * @param {Object} change
   * @param {string[]} change.days - Lowercase weekday names
   * @param {string} change.startTime - 'HH:MM'
   * @param {Date|null} [change.startDate] - New start date (only before the series has started)
   * @param {Date|null} [change.endDate] - New (later) end date, if also extended
   * @param {Object} [change.seriesUpdates] - Other series fields to save in the same transaction
   * @param {Date} [change.now]
   * @returns {Promise<{ upcomingCount: number, created: number, removed: number, moved: number, nextSession: Object|null }>}
   */
  async rescheduleSeries(series, { days, startTime, startDate = null, endDate = null, seriesUpdates = {}, now = new Date() }) {
    const current = typeof series.recurrencePattern === 'string'
      ? JSON.parse(series.recurrencePattern)
      : series.recurrencePattern;
    const pattern = {
      ...current,
      days: days.map((d) => String(d).toLowerCase()),
      startTime,
      duration: Number(current.duration)
    };

    return sequelize.transaction(async (transaction) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:seriesId))', {
        replacements: { seriesId: String(series.id) },
        transaction
      });

      const sessions = await LiveSession.findAll({
        where: { seriesId: series.id },
        order: [['scheduledStartTime', 'ASC'], ['sessionNumber', 'ASC']],
        transaction
      });

      if (sessions.some((s) => s.status === 'live')) {
        throw scheduleError('SESSION_LIVE', 'End the live session before changing the schedule');
      }
      const started = sessions.some(wasHeld);
      if (startDate && started) {
        throw scheduleError('ALREADY_STARTED', "The start date can't change once the first session has run");
      }

      const replaceable = sessions.filter((s) =>
        s.status === 'scheduled' &&
        !s.actualStartTime &&
        (!started || new Date(s.scheduledStartTime) > now)
      );
      const replaceableIds = new Set(replaceable.map((s) => s.id));
      const kept = sessions.filter((s) => !replaceableIds.has(s.id));

      // Same day-by-day rule as when the series was created. From the start
      // date if it's still ahead, otherwise from today; never in the past, and
      // never a second class on a day one has already run.
      const effectiveStart = new Date(startDate || series.startDate);
      const effectiveEnd = new Date(endDate || series.endDate);
      let windowStart = effectiveStart;
      if (windowStart <= now) {
        windowStart = new Date(now);
        windowStart.setHours(0, 0, 0, 0);
      }
      const heldDays = new Set(kept.filter(wasHeld).map((s) => localDayKey(s.scheduledStartTime)));
      const generated = this.generateSessionSchedule({
        id: series.id,
        recurrencePattern: pattern,
        startDate: windowStart,
        endDate: effectiveEnd
      }).filter((s) => s.scheduledStartTime > now && !heldDays.has(localDayKey(s.scheduledStartTime)));

      if (generated.length === 0) {
        throw scheduleError(
          'NO_SESSIONS',
          'No sessions fall on the chosen days between the start and end dates. Pick other days or a later end date.'
        );
      }

      // Upcoming sessions are numbered on from the last kept one.
      const base = kept.reduce((max, s) => Math.max(max, Number(s.sessionNumber) || 0), 0);
      generated.forEach((s, i) => { s.sessionNumber = base + i + 1; });

      const reuseCount = Math.min(replaceable.length, generated.length);
      const reused = replaceable.slice(0, reuseCount);
      const surplus = replaceable.slice(reuseCount);
      const extra = generated.slice(reuseCount);

      if (surplus.length > 0) {
        await LiveSession.destroy({ where: { id: surplus.map((s) => s.id) }, transaction });
      }

      // (series_id, session_number) is unique: park renumbered rows on
      // temporary negative numbers first so no update collides mid-way.
      const renumbered = reused.filter((s, i) => s.sessionNumber !== generated[i].sessionNumber);
      for (const [i, s] of renumbered.entries()) {
        await s.update({ sessionNumber: -(i + 1) }, { transaction });
      }

      let moved = 0;
      for (const [i, s] of reused.entries()) {
        const next = generated[i];
        const timeChanged =
          new Date(s.scheduledStartTime).getTime() !== next.scheduledStartTime.getTime() ||
          new Date(s.scheduledEndTime).getTime() !== next.scheduledEndTime.getTime();
        if (!timeChanged && s.sessionNumber === next.sessionNumber) continue;
        const changes = { sessionNumber: next.sessionNumber };
        if (timeChanged) {
          moved += 1;
          Object.assign(changes, {
            scheduledStartTime: next.scheduledStartTime,
            scheduledEndTime: next.scheduledEndTime,
            reminderSent: false
          });
        }
        await s.update(changes, { transaction });
      }

      if (extra.length > 0) {
        await LiveSession.bulkCreate(extra, { transaction });
      }

      await series.update({
        ...seriesUpdates,
        recurrencePattern: pattern,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      }, { transaction });

      const first = generated[0];
      return {
        upcomingCount: generated.length,
        created: extra.length,
        removed: surplus.length,
        moved,
        nextSession: {
          id: reused[0] ? reused[0].id : null,
          sessionNumber: first.sessionNumber,
          scheduledStartTime: first.scheduledStartTime
        }
      };
    });
  }

  /**
   * Validate recurrence pattern
   * @param {Object} pattern - Recurrence pattern object
   * @returns {Object} { valid: boolean, errors: Array }
   */
  validateRecurrencePattern(pattern) {
    const errors = [];
    
    if (!pattern.days || !Array.isArray(pattern.days) || pattern.days.length === 0) {
      errors.push('Days array is required and must not be empty');
    }
    
    const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    if (pattern.days) {
      pattern.days.forEach(day => {
        if (!validDays.includes(day.toLowerCase())) {
          errors.push(`Invalid day: ${day}`);
        }
      });
    }
    
    if (!pattern.startTime || !/^\d{2}:\d{2}$/.test(pattern.startTime)) {
      errors.push('Start time is required and must be in HH:MM format');
    }
    
    if (!pattern.duration || typeof pattern.duration !== 'number' || pattern.duration <= 0) {
      errors.push('Duration is required and must be a positive number (minutes)');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = new LiveSeriesService();
