const Purchase = require('../models/Purchase');
const LiveClass = require('../models/liveClass');

/**
 * Custom middleware for ZegoCloud routes
 * Checks if user has access to ZegoCloud live class
 * Reads liveClassId from request body (not URL params)
 */
exports.checkZegoCloudAccess = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    
    // ✅ Get liveClassId from request body (ZegoCloud specific)
    const { liveClassId } = req.body;

    // Validate liveClassId
    if (!liveClassId) {
      return res.status(400).json({
        success: false,
        message: 'Live class ID is required'
      });
    }

    // Get live class
    const liveClass = await LiveClass.findByPk(liveClassId);

    // Check if live class exists
    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found'
      });
    }

    // ✅ Check if it's a ZegoCloud live class
    if (liveClass.streaming_provider !== 'zegocloud') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for ZegoCloud live classes'
      });
    }

    // Check if content is free (price = 0)
    const price = parseFloat(liveClass.price);
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
        message: 'Authentication required to access paid live class',
        requiresPayment: true,
        price: liveClass.price,
        amount: liveClass.price,
        currency: liveClass.currency || 'NGN',
        contentType: 'live_class',
        contentId: liveClassId
      });
    }

    // Check if user is the creator (creators have access to their own content)
    if (liveClass.userId && liveClass.userId === userId) {
      req.hasAccess = true;
      req.accessReason = 'creator';
      return next();
    }

    // Check if user has purchased the live class
    const purchase = await Purchase.findOne({
      where: {
        userId,
        contentType: 'live_class',
        contentId: liveClassId,
        paymentStatus: 'completed'
      }
    });

    if (purchase) {
      // User has purchased - allow access
      req.hasAccess = true;
      req.accessReason = 'purchased';
      req.purchaseDate = purchase.createdAt;
      return next();
    }

    // User has not purchased - deny access
    return res.status(402).json({
      success: false,
      message: 'Payment required to access this live class',
      code: 'PAYMENT_REQUIRED',
      requiresPayment: true,
      price: liveClass.price,
      amount: liveClass.price,
      currency: liveClass.currency || 'NGN',
      contentType: 'live_class',
      contentId: liveClassId,
      title: liveClass.title,
      description: liveClass.description
    });
  } catch (error) {
    console.error('ZegoCloud access control error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking live class access'
    });
  }
};

/**
 * Middleware for ZegoCloud routes that use URL params (like /room/:id)
 * This handles routes where liveClassId is in the URL instead of body
 */
exports.checkZegoCloudAccessByParam = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    
    // ✅ Get liveClassId from URL params
    const { id: liveClassId } = req.params;

    // Validate liveClassId
    if (!liveClassId) {
      return res.status(400).json({
        success: false,
        message: 'Live class ID is required'
      });
    }

    // Get live class
    const liveClass = await LiveClass.findByPk(liveClassId);

    // Check if live class exists
    if (!liveClass) {
      return res.status(404).json({
        success: false,
        message: 'Live class not found'
      });
    }

    // ✅ Check if it's a ZegoCloud live class
    if (liveClass.streaming_provider !== 'zegocloud') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for ZegoCloud live classes'
      });
    }

    // Check if content is free (price = 0)
    const price = parseFloat(liveClass.price);
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
        message: 'Authentication required to access paid live class',
        requiresPayment: true,
        price: liveClass.price,
        amount: liveClass.price,
        currency: liveClass.currency || 'NGN',
        contentType: 'live_class',
        contentId: liveClassId
      });
    }

    // Check if user is the creator (creators have access to their own content)
    if (liveClass.userId && liveClass.userId === userId) {
      req.hasAccess = true;
      req.accessReason = 'creator';
      return next();
    }

    // Check if user has purchased the live class
    const purchase = await Purchase.findOne({
      where: {
        userId,
        contentType: 'live_class',
        contentId: liveClassId,
        paymentStatus: 'completed'
      }
    });

    if (purchase) {
      // User has purchased - allow access
      req.hasAccess = true;
      req.accessReason = 'purchased';
      req.purchaseDate = purchase.createdAt;
      return next();
    }

    // User has not purchased - deny access
    return res.status(402).json({
      success: false,
      message: 'Payment required to access this live class',
      code: 'PAYMENT_REQUIRED',
      requiresPayment: true,
      price: liveClass.price,
      amount: liveClass.price,
      currency: liveClass.currency || 'NGN',
      contentType: 'live_class',
      contentId: liveClassId,
      title: liveClass.title,
      description: liveClass.description
    });
  } catch (error) {
    console.error('ZegoCloud access control error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking live class access'
    });
  }
};
