/**
 * Admin Role Middleware
 * 
 * Checks if authenticated user has admin role
 * Must be used after authMiddleware
 */

module.exports = (req, res, next) => {
  // Check if user is authenticated (should be set by authMiddleware)
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      message: 'Authentication required' 
    });
  }

  // Check if user has admin role
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false,
      message: 'Access denied. Admin privileges required.' 
    });
  }

  // User is admin, proceed
  next();
};
