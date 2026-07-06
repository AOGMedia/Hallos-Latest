const { LiveSeries, LiveSession } = require('../models/liveSeriesIndex');
const liveSeriesService = require('../services/liveSeriesService');
const User = require('../models/User');
const { Op } = require('sequelize');

/**
 * Create a new live series
 * POST /api/live/series/create
 */
exports.createSeries = async (req, res) => {
  try {
    let {
      title,
      description,
      price,
      currency,
      category,
      thumbnailUrl,
      startDate,
      endDate,
      recurrencePattern,
      privacy,
      maxParticipants
    } = req.body;
    
    const userId = req.user.id;
    
    // Parse recurrencePattern if it's a string (from FormData)
    if (typeof recurrencePattern === 'string') {
      try {
        recurrencePattern = JSON.parse(recurrencePattern);
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          message: 'Invalid recurrence pattern JSON format. Must be valid JSON.'
        });
      }
    }
    
    // Validate required fields
    if (!title || !startDate || !endDate || !recurrencePattern) {
      return res.status(400).json({
        success: false,
        message: 'Title, start date, end date, and recurrence pattern are required'
      });
    }
    
    // Validate recurrence pattern
    const patternValidation = liveSeriesService.validateRecurrencePattern(recurrencePattern);
    if (!patternValidation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid recurrence pattern',
        errors: patternValidation.errors
      });
    }
    
    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: 'End date must be after start date'
      });
    }

    // Allow scheduling up to 24 hours in the past to account for timezone differences
    // between the user's local time and the server's UTC time
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (start < twentyFourHoursAgo) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be more than 24 hours in the past'
      });
    }
    
    // Handle thumbnail - either from file upload or URL string
    const thumbnailFile = req.files?.thumbnail?.[0] || req.files?.thumbnailUrl?.[0] || req.files?.image?.[0] || req.files?.file?.[0];
    const finalThumbnailUrl = thumbnailFile 
      ? (thumbnailFile.location || `/upload/${thumbnailFile.filename}`)
      : thumbnailUrl || null;
    
    // Validate currency
    const validCurrencies = ['NGN', 'USD'];
    const finalCurrency = currency && validCurrencies.includes(currency.toUpperCase()) 
      ? currency.toUpperCase() 
      : 'NGN';
    
    // Create series
    const series = await LiveSeries.create({
      userId,
      title,
      description,
      price: price || 0,
      currency: finalCurrency,
      category,
      thumbnailUrl: finalThumbnailUrl,
      startDate: start,
      endDate: end,
      recurrencePattern,
      privacy: privacy || 'public',
      maxParticipants: maxParticipants || 200,
      status: 'active'
    });
    
    // Generate and create sessions
    const sessions = await liveSeriesService.createSessionsForSeries(series);
    
    console.log(`[Live Series Controller] Created series ${series.id} with ${sessions.length} sessions`);
    
    return res.status(201).json({
      success: true,
      message: 'Live series created successfully',
      series: {
        ...series.dataValues,
        totalSessions: sessions.length,
        pricing: series.getDualPricing()
      }
    });

    // Queue digest notifications in background (fire-and-forget)
    setImmediate(async () => {
      try {
        const audienceService = require('../services/audienceService');
        await audienceService.queueDigestItems(series, 'live_series');
      } catch (e) {
        console.error('[LiveSeries Controller] Failed to queue digest items:', e.message);
      }
    });

  } catch (error) {
    console.error('[Live Series Controller] Create series error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create live series',
      error: error.message
    });
  }
};

/**
 * Get all live series (public listing)
 * GET /api/live/series
 */
exports.getAllSeries = async (req, res) => {
  try {
    const { status, privacy, category } = req.query;
    
    const where = {};
    
    // Filter by privacy (default to public for unauthenticated users)
    if (privacy) {
      where.privacy = privacy;
    } else {
      where.privacy = 'public';
    }
    
    // Filter by status (default to active)
    if (status) {
      where.status = status;
    } else {
      where.status = 'active';
    }
    
    // Filter by category
    if (category) {
      where.category = category;
    }
    
    const series = await LiveSeries.findAll({
      where,
      order: [['startDate', 'ASC']],
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ]
    });
    
    // Get session counts for each series
    const seriesWithStats = await Promise.all(
      series.map(async (s) => {
        const stats = await liveSeriesService.calculateSeriesStats(s.id);
        return {
          ...s.dataValues,
          stats,
          pricing: s.getDualPricing()
        };
      })
    );
    
    return res.json({
      success: true,
      count: seriesWithStats.length,
      series: seriesWithStats
    });
    
  } catch (error) {
    console.error('[Live Series Controller] Get all series error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch live series'
    });
  }
};

/**
 * Get creator's own series
 * GET /api/live/series/my-series
 */
exports.getMySeries = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;
    
    const where = { userId };
    
    if (status) {
      where.status = status;
    }
    
    const series = await LiveSeries.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ]
    });
    
    // Get session counts and stats for each series
    const seriesWithStats = await Promise.all(
      series.map(async (s) => {
        const stats = await liveSeriesService.calculateSeriesStats(s.id);
        return {
          ...s.dataValues,
          stats,
          pricing: s.getDualPricing()
        };
      })
    );
    
    return res.json({
      success: true,
      count: seriesWithStats.length,
      series: seriesWithStats
    });
    
  } catch (error) {
    console.error('[Live Series Controller] Get my series error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch your series'
    });
  }
};

/**
 * Get series by ID
 * GET /api/live/series/:id
 */
exports.getSeriesById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const series = await LiveSeries.findByPk(id, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'firstname', 'lastname', 'email']
        }
      ]
    });
    
    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Series not found'
      });
    }
    
    // Get statistics
    const stats = await liveSeriesService.calculateSeriesStats(series.id);
    
    // Check if user has access (optional authentication)
    let hasAccess = false;
    let accessReason = null;
    let isRegistered = false;
    const price = parseFloat(series.price);

    // Check if free
    if (price === 0) {
      hasAccess = true;
      accessReason = 'free_content';
    }

    // Check if user is authenticated and has access
    if (req.user && !hasAccess) {
      hasAccess = await liveSeriesService.checkSeriesAccess(req.user.id, series.id);
      if (hasAccess) {
        if (series.userId === req.user.id) {
          accessReason = 'creator';
        } else {
          accessReason = 'purchased';
        }
      }
    }

    // Check if user has secured a free spot
    if (req.user && price === 0) {
      const LiveSeriesRegistration = require('../models/LiveSeriesRegistration');
      const reg = await LiveSeriesRegistration.findOne({
        where: { seriesId: id, userId: req.user.id }
      });
      isRegistered = !!reg;
    } else if (req.user && hasAccess && accessReason === 'purchased') {
      // Paid users are registered by virtue of their purchase
      isRegistered = true;
    }

    return res.json({
      success: true,
      series: {
        ...series.dataValues,
        stats,
        hasAccess,
        accessReason,
        isRegistered,
        requiresPayment: !hasAccess && price > 0,
        pricing: series.getDualPricing()
      }
    });
    
  } catch (error) {
    console.error('[Live Series Controller] Get series by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch series details'
    });
  }
};

/**
 * Get all sessions for a series
 * GET /api/live/series/:id/sessions
 */
exports.getSeriesSessions = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, upcoming, past } = req.query;
    
    // Verify series exists
    const series = await LiveSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Series not found'
      });
    }
    
    // Build filters
    const filters = {};
    if (status) filters.status = status;
    if (upcoming === 'true') filters.upcoming = true;
    if (past === 'true') filters.past = true;
    
    // Get sessions
    const sessions = await liveSeriesService.getSeriesSessions(id, filters);
    
    return res.json({
      success: true,
      count: sessions.length,
      sessions
    });
    
  } catch (error) {
    console.error('[Live Series Controller] Get series sessions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch sessions'
    });
  }
};

/**
 * Update series
 * PUT /api/live/series/:id
 */
exports.updateSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const {
      title,
      description,
      price,
      category,
      thumbnailUrl,
      privacy,
      maxParticipants,
      endDate
    } = req.body;
    
    // Get series
    const series = await LiveSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Series not found'
      });
    }
    
    // Check ownership
    if (series.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can update this series'
      });
    }
    
    // Handle thumbnail
    const thumbnailFile = req.files?.thumbnail?.[0] || req.files?.thumbnailUrl?.[0];
    const finalThumbnailUrl = thumbnailFile 
      ? (thumbnailFile.location || `/upload/${thumbnailFile.filename}`)
      : thumbnailUrl || series.thumbnailUrl;
    
    // Update fields
    const updates = {};
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = price;
    if (category !== undefined) updates.category = category;
    if (finalThumbnailUrl) updates.thumbnailUrl = finalThumbnailUrl;
    if (privacy) updates.privacy = privacy;
    if (maxParticipants) updates.maxParticipants = maxParticipants;
    
    // Handle end date extension
    let newSessionsGenerated = 0;
    if (endDate) {
      const newEndDate = new Date(endDate);
      const currentEndDate = new Date(series.endDate);
      
      // Validate: new end date must be after current end date (extension only)
      if (newEndDate <= currentEndDate) {
        return res.status(400).json({
          success: false,
          message: 'End date can only be extended (moved forward). Cannot shorten the series.'
        });
      }
      
      // Validate: new end date must be in the future
      if (newEndDate <= new Date()) {
        return res.status(400).json({
          success: false,
          message: 'End date must be in the future'
        });
      }
      
      console.log(`[Live Series Controller] Extending series ${id} end date from ${currentEndDate} to ${newEndDate}`);
      
      // Update end date
      updates.endDate = newEndDate;
      
      // Generate additional sessions for the extended period
      const additionalSessions = await liveSeriesService.extendSeriesSessions(series, newEndDate);
      newSessionsGenerated = additionalSessions.length;
      
      console.log(`[Live Series Controller] Generated ${newSessionsGenerated} additional sessions`);
    }
    
    await series.update(updates);
    
    const response = {
      success: true,
      message: 'Series updated successfully',
      series: {
        ...series.dataValues,
        pricing: series.getDualPricing()
      }
    };
    
    // Include info about new sessions if end date was extended
    if (newSessionsGenerated > 0) {
      response.message = `Series updated successfully. ${newSessionsGenerated} additional session(s) generated.`;
      response.newSessionsCount = newSessionsGenerated;
    }
    
    return res.json(response);
    
  } catch (error) {
    console.error('[Live Series Controller] Update series error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update series',
      error: error.message
    });
  }
};

/**
 * Cancel series
 * DELETE /api/live/series/:id
 */
exports.cancelSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Get series
    const series = await LiveSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Series not found'
      });
    }
    
    // Check ownership
    if (series.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the creator can cancel this series'
      });
    }
    
    // Check if can be cancelled
    const canCancel = liveSeriesService.canCancelSeries(series);
    if (!canCancel.canCancel) {
      return res.status(400).json({
        success: false,
        message: canCancel.reason
      });
    }
    
    // Update series status
    await series.update({ status: 'cancelled' });
    
    // Cancel all scheduled sessions
    await LiveSession.update(
      { status: 'cancelled' },
      {
        where: {
          seriesId: id,
          status: 'scheduled'
        }
      }
    );
    
    return res.json({
      success: true,
      message: 'Series cancelled successfully'
    });
    
  } catch (error) {
    console.error('[Live Series Controller] Cancel series error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel series'
    });
  }
};

module.exports = exports;

// ============================
//  LINK LIVE SERIES TO COMMUNITY
// ============================
exports.linkLiveSeriesToCommunity = async (req, res) => {
  try {
    const { id } = req.params;
    const { communityId, communityVisibility = 'community_only' } = req.body;
    const userId = req.user.id;

    if (!communityId) {
      return res.status(400).json({ success: false, message: 'communityId is required' });
    }

    const LiveSeries = require('../models/LiveSeries');
    const series = await LiveSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({ success: false, message: 'Live series not found' });
    }

    if (series.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const Community = require('../models/Community');
    const CommunityMember = require('../models/CommunityMember');
    const CommunityContentSubmission = require('../models/CommunityContentSubmission');

    const community = await Community.findByPk(communityId);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const membership = req.user.role === 'admin' ? null : await CommunityMember.findOne({
      where: { communityId, userId, status: 'active' }
    });

    const canDirectLink = req.user.role === 'admin' ||
      (membership && ['owner', 'moderator'].includes(membership.role));

    if (canDirectLink) {
      await series.update({ communityId, communityVisibility });
      return res.json({ success: true, queued: false, data: series });
    }

    if (!membership) {
      return res.status(403).json({ success: false, message: 'You must be an active member of this community.' });
    }

    const submission = await CommunityContentSubmission.create({
      communityId,
      submittedBy: userId,
      contentType: 'live_series',
      contentData: { ...series.toJSON(), communityVisibility },
      status: 'pending'
    });

    return res.status(201).json({
      success: true,
      queued: true,
      message: 'Your live series has been submitted for moderator review.',
      data: submission
    });
  } catch (error) {
    console.error('[LiveSeries Controller] Link to community error:', error);
    return res.status(500).json({ success: false, message: 'Failed to link live series to community' });
  }
};


// ============================
//  SECURE A SPOT (free live series only)
// ============================
exports.registerForSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { LiveSeries } = require('../models/liveSeriesIndex');
    const LiveSeriesRegistration = require('../models/LiveSeriesRegistration');

    const series = await LiveSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({ success: false, message: 'Live series not found' });
    }

    if (!series.canEnroll()) {
      return res.status(400).json({ success: false, message: 'This series is no longer accepting registrations' });
    }

    const price = parseFloat(series.price);
    if (price > 0) {
      return res.status(400).json({
        success: false,
        message: 'This is a paid live series. Please complete payment to register.'
      });
    }

    // Check if already registered
    const existing = await LiveSeriesRegistration.findOne({ where: { seriesId: id, userId } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already secured a spot for this series.' });
    }

    // Check capacity
    if (series.maxParticipants) {
      const count = await LiveSeriesRegistration.count({ where: { seriesId: id } });
      if (count >= series.maxParticipants) {
        return res.status(400).json({ success: false, message: 'Sorry, this series is full.' });
      }
    }

    const registration = await LiveSeriesRegistration.create({ seriesId: id, userId });

    return res.status(201).json({
      success: true,
      message: 'Spot secured! You will receive reminders before each session starts.',
      data: registration
    });
  } catch (error) {
    console.error('[LiveSeries Controller] Register error:', error);
    return res.status(500).json({ success: false, message: 'Failed to secure spot' });
  }
};

// ============================
//  CANCEL SPOT (free live series)
// ============================
exports.cancelSeriesRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const LiveSeriesRegistration = require('../models/LiveSeriesRegistration');
    const registration = await LiveSeriesRegistration.findOne({ where: { seriesId: id, userId } });
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found' });
    }

    await registration.destroy();
    return res.json({ success: true, message: 'Registration cancelled.' });
  } catch (error) {
    console.error('[LiveSeries Controller] Cancel registration error:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel registration' });
  }
};

// ============================
//  GET REGISTRATIONS (creator/admin)
// ============================
exports.getSeriesRegistrations = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { LiveSeries } = require('../models/liveSeriesIndex');
    const LiveSeriesRegistration = require('../models/LiveSeriesRegistration');
    const Purchase = require('../models/Purchase');
    const User = require('../models/User');

    const series = await LiveSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({ success: false, message: 'Live series not found' });
    }

    // Only creator or admin
    if (series.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [freeRegs, paidPurchases, totalFree, totalPaid] = await Promise.all([
      LiveSeriesRegistration.findAll({
        where: { seriesId: id },
        include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }],
        limit,
        offset,
        order: [['createdAt', 'DESC']]
      }),
      Purchase.findAll({
        where: { contentType: 'live_series', contentId: id, paymentStatus: 'completed' },
        include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }],
        order: [['createdAt', 'DESC']]
      }),
      LiveSeriesRegistration.count({ where: { seriesId: id } }),
      Purchase.count({ where: { contentType: 'live_series', contentId: id, paymentStatus: 'completed' } })
    ]);

    const freeList = freeRegs.map(r => ({
      userId: r.userId,
      firstname: r.user?.firstname,
      lastname: r.user?.lastname,
      email: r.user?.email,
      registrationType: 'free',
      registeredAt: r.createdAt
    }));

    const paidList = paidPurchases.map(p => ({
      userId: p.userId,
      firstname: p.user?.firstname,
      lastname: p.user?.lastname,
      email: p.user?.email,
      registrationType: 'paid',
      amount: parseFloat(p.amount),
      currency: p.currency,
      registeredAt: p.createdAt
    }));

    return res.json({
      success: true,
      data: {
        total: totalFree + totalPaid,
        totalFree,
        totalPaid,
        page,
        limit,
        registrations: [...paidList, ...freeList]
      }
    });
  } catch (error) {
    console.error('[LiveSeries Controller] Get registrations error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch registrations' });
  }
};
