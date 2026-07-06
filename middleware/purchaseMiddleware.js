const Purchase = require('../models/Purchase');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');
const jwt = require('jsonwebtoken');

/**
 * Helper function to extract user from token (optional authentication)
 */
const extractUserFromToken = (req) => {
  try {
    // Try header first
    let token = req.header('Authorization')?.replace('Bearer ', '');
    // If not in header, try cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    return decoded;
  } catch (error) {
    return null;
  }
};

/**
 * Middleware to check if user has access to content
 * Checks if content is free or if user has purchased it
 */
exports.checkContentAccess = async (req, res, next) => {
  try {
    // Extract user from token (optional authentication)
    const user = req.user || extractUserFromToken(req);
    const userId = user ? user.id : null;
    const { id } = req.params;

    console.log(`[Purchase Middleware] Checking access for content ${id}, user: ${userId}`);

    // Determine content type from the route
    let contentType, contentId, content;
    
    if (req.baseUrl.includes('/videos')) {
      contentType = 'video';
      contentId = id;
      content = await Video.findByPk(contentId);
    } else if (req.baseUrl.includes('/live')) {
      contentType = 'live_class';
      contentId = id;
      content = await LiveClass.findByPk(contentId);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid content type'
      });
    }

    // Check if content exists
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Check if content is free (price = 0)
    const price = parseFloat(content.price);
    if (price === 0) {
      // Free content - allow access
      req.hasAccess = true;
      req.accessReason = 'free_content';
      return next();
    }

    // Check if user is authenticated
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to access paid content',
        requiresPayment: true,
        price: content.price,
        currency: content.currency || 'NGN',
        contentType,
        contentId
      });
    }

    // Check if user is the creator (creators have access to their own content)
    if (content.userId && content.userId === userId) {
      req.hasAccess = true;
      req.accessReason = 'creator';
      return next();
    }

    // For live classes, check if user is a co-host
    if (contentType === 'live_class') {
      const { LiveHost } = require('../models/liveIndex');
      const isHost = await LiveHost.findOne({
        where: {
          liveClassId: contentId,
          userId: userId
        }
      });

      if (isHost) {
        req.hasAccess = true;
        req.accessReason = isHost.role === 'creator' ? 'creator' : 'cohost';
        console.log(`[Purchase Middleware] Access GRANTED for ${isHost.role} user ${userId}`);
        return next();
      }
    }

    // Check if user has purchased the content
    const purchase = await Purchase.findOne({
      where: {
        userId,
        contentType,
        contentId,
        paymentStatus: 'completed'
      }
    });

    console.log(`[Purchase Middleware] Purchase lookup for user ${userId}, content ${contentId}:`, purchase ? 'FOUND' : 'NOT FOUND');

    if (purchase) {
      // User has purchased - allow access
      req.hasAccess = true;
      req.accessReason = 'purchased';
      req.purchaseDate = purchase.createdAt;
      console.log(`[Purchase Middleware] Access GRANTED for user ${userId}`);
      return next();
    }

    // User has not purchased - deny access
    return res.status(402).json({
      success: false,
      message: 'Payment required to access this content',
      requiresPayment: true,
      price: content.price,
      currency: content.currency || 'NGN',
      contentType,
      contentId,
      title: content.title,
      description: content.description
    });
  } catch (error) {
    console.error('Access control error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking content access'
    });
  }
};

/**
 * Optional middleware to check if content requires purchase
 * This can be used for endpoints that need to know payment status but don't block access
 */
exports.checkPurchaseStatus = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const { contentType, contentId } = req.query;

    if (!contentType || !contentId) {
      req.purchaseStatus = { checked: false };
      return next();
    }

    // Get content
    let content;
    if (contentType === 'video') {
      content = await Video.findByPk(contentId);
    } else if (contentType === 'live_class') {
      content = await LiveClass.findByPk(contentId);
    }

    if (!content) {
      req.purchaseStatus = { checked: false };
      return next();
    }

    // Check if free
    if (parseFloat(content.price) === 0) {
      req.purchaseStatus = {
        checked: true,
        requiresPayment: false,
        reason: 'free_content'
      };
      return next();
    }

    // Check if purchased
    if (userId) {
      const purchase = await Purchase.findOne({
        where: {
          userId,
          contentType,
          contentId,
          paymentStatus: 'completed'
        }
      });

      if (purchase) {
        req.purchaseStatus = {
          checked: true,
          requiresPayment: false,
          reason: 'purchased',
          purchaseDate: purchase.createdAt
        };
        return next();
      }
    }

    // Requires payment
    req.purchaseStatus = {
      checked: true,
      requiresPayment: true,
      price: content.price,
      currency: content.currency || 'NGN'
    };
    return next();
  } catch (error) {
    console.error('Purchase status check error:', error);
    req.purchaseStatus = { checked: false, error: true };
    return next();
  }
};
