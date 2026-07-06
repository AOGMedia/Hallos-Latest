const Company = require('../models/Company');
const CollaborationRequest = require('../models/CollaborationRequest');
const User = require('../models/User');
const { Op } = require('sequelize');
const { sendCollaborationRequestEmail } = require('../utils/email');

/**
 * UGC Agency Controller
 * 
 * Handles UGC creator agency features:
 * - Get all companies (with filters and search)
 * - Get single company
 * - Send collaboration request
 * - Admin: View all collaboration requests
 * - Admin: Update collaboration request status
 */

/**
 * Get all companies
 * GET /api/ugc/companies
 */
exports.getAllCompanies = async (req, res) => {
  try {
    const { industry, search, page = 1, limit = 20 } = req.query;

    // Build filter conditions
    const where = {};
    
    // Filter by industry
    if (industry) {
      where.industry = industry;
    }
    
    // Search by company name
    if (search) {
      where.companyName = {
        [Op.iLike]: `%${search}%` // Case-insensitive search
      };
    }

    const offset = (page - 1) * limit;

    const { count, rows: companies } = await Company.findAndCountAll({
      where,
      attributes: ['id', 'companyName', 'industry', 'website'],
      order: [['companyName', 'ASC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.json({
      success: true,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      },
      companies
    });
  } catch (error) {
    console.error('[UGC Controller] Get all companies error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch companies'
    });
  }
};

/**
 * Get all unique industries
 * GET /api/ugc/industries
 */
exports.getAllIndustries = async (req, res) => {
  try {
    const industries = await Company.findAll({
      attributes: [[Company.sequelize.fn('DISTINCT', Company.sequelize.col('industry')), 'industry']],
      order: [['industry', 'ASC']],
      raw: true
    });

    return res.json({
      success: true,
      industries: industries.map(i => i.industry)
    });
  } catch (error) {
    console.error('[UGC Controller] Get industries error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch industries'
    });
  }
};

/**
 * Get single company by ID
 * GET /api/ugc/companies/:id
 */
exports.getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    const company = await Company.findByPk(id, {
      attributes: ['id', 'companyName', 'industry', 'website', 'contactName', 'contactEmail']
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    return res.json({
      success: true,
      company
    });
  } catch (error) {
    console.error('[UGC Controller] Get company by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch company'
    });
  }
};

/**
 * Send collaboration request
 * POST /api/ugc/companies/:id/collaborate
 */
exports.sendCollaborationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    // Validate message
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    if (message.length < 50) {
      return res.status(400).json({
        success: false,
        message: 'Message must be at least 50 characters long'
      });
    }

    // Check rate limit (10 requests per day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const requestsToday = await CollaborationRequest.count({
      where: {
        userId,
        sentAt: {
          [Op.gte]: today
        }
      }
    });

    if (requestsToday >= 10) {
      return res.status(429).json({
        success: false,
        message: 'You have reached the daily limit of 10 collaboration requests. Please try again tomorrow.'
      });
    }

    // Get company details
    const company = await Company.findByPk(id);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Get user details
    const user = await User.findByPk(userId, {
      attributes: ['id', 'firstname', 'lastname', 'email']
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create collaboration request record
    const collaborationRequest = await CollaborationRequest.create({
      userId,
      companyId: id,
      message,
      status: 'sent',
      sentAt: new Date()
    });

    // Send email to company (with CC to user)
    const userFullName = `${user.firstname} ${user.lastname}`;
    
    await sendCollaborationRequestEmail(
      company.contactEmail,
      user.email,
      {
        companyName: company.companyName,
        contactName: company.contactName,
        userFullName,
        userFirstName: user.firstname,
        message
      }
    );

    return res.status(201).json({
      success: true,
      message: 'Collaboration request sent successfully! You have been CC\'d on the email.',
      collaborationRequest: {
        id: collaborationRequest.id,
        companyName: company.companyName,
        sentAt: collaborationRequest.sentAt,
        status: collaborationRequest.status
      },
      remainingRequests: 10 - requestsToday - 1
    });
  } catch (error) {
    console.error('[UGC Controller] Send collaboration request error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send collaboration request'
    });
  }
};

/**
 * Get user's collaboration request history
 * GET /api/ugc/my-requests
 */
exports.getMyCollaborationRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const offset = (page - 1) * limit;

    const { count, rows: requests } = await CollaborationRequest.findAndCountAll({
      where: { userId },
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'companyName', 'industry', 'website']
        }
      ],
      order: [['sentAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.json({
      success: true,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      },
      requests
    });
  } catch (error) {
    console.error('[UGC Controller] Get my collaboration requests error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch collaboration requests'
    });
  }
};

/**
 * ADMIN: Get all collaboration requests
 * GET /api/ugc/admin/requests
 */
exports.getAllCollaborationRequests = async (req, res) => {
  try {
    const { status, companyId, userId, page = 1, limit = 20 } = req.query;

    // Build filter conditions
    const where = {};
    if (status) where.status = status;
    if (companyId) where.companyId = parseInt(companyId);
    if (userId) where.userId = parseInt(userId);

    const offset = (page - 1) * limit;

    const { count, rows: requests } = await CollaborationRequest.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email', 'role']
        },
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'companyName', 'industry', 'contactEmail']
        }
      ],
      order: [['sentAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.json({
      success: true,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      },
      requests
    });
  } catch (error) {
    console.error('[UGC Controller] Get all collaboration requests error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch collaboration requests'
    });
  }
};

/**
 * ADMIN: Update collaboration request status
 * PATCH /api/ugc/admin/requests/:id
 */
exports.updateCollaborationRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['sent', 'pending', 'responded', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const request = await CollaborationRequest.findByPk(id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Collaboration request not found'
      });
    }

    await request.update({ status });

    // Fetch updated request with details
    const updatedRequest = await CollaborationRequest.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email']
        },
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'companyName', 'industry']
        }
      ]
    });

    return res.json({
      success: true,
      message: 'Collaboration request status updated successfully',
      request: updatedRequest
    });
  } catch (error) {
    console.error('[UGC Controller] Update collaboration request status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update collaboration request status'
    });
  }
};

/**
 * ADMIN: Get collaboration request statistics
 * GET /api/ugc/admin/stats
 */
exports.getCollaborationStats = async (req, res) => {
  try {
    const sequelize = Company.sequelize;

    // Total requests
    const totalRequests = await CollaborationRequest.count();

    // Requests by status
    const statusCounts = await CollaborationRequest.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Requests in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentRequests = await CollaborationRequest.count({
      where: {
        sentAt: {
          [Op.gte]: sevenDaysAgo
        }
      }
    });

    // Top companies by requests
    const topCompanies = await CollaborationRequest.findAll({
      attributes: [
        'companyId',
        [sequelize.fn('COUNT', sequelize.col('CollaborationRequest.id')), 'requestCount']
      ],
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['companyName', 'industry']
        }
      ],
      group: ['companyId', 'company.id'],
      order: [[sequelize.fn('COUNT', sequelize.col('CollaborationRequest.id')), 'DESC']],
      limit: 10,
      raw: false
    });

    // Total companies
    const totalCompanies = await Company.count();

    return res.json({
      success: true,
      stats: {
        totalRequests,
        totalCompanies,
        recentRequests,
        byStatus: statusCounts.reduce((acc, item) => {
          acc[item.status] = parseInt(item.count);
          return acc;
        }, {}),
        topCompanies: topCompanies.map(item => ({
          companyId: item.companyId,
          companyName: item.company.companyName,
          industry: item.company.industry,
          requestCount: parseInt(item.dataValues.requestCount)
        }))
      }
    });
  } catch (error) {
    console.error('[UGC Controller] Get collaboration stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get collaboration statistics'
    });
  }
};
