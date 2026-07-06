const { LiveSeries, LiveSession } = require('../models/liveSeriesIndex');
const Purchase = require('../models/Purchase');
const { Op } = require('sequelize');

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
