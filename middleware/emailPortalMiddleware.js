const User = require('../models/User');

const PORTAL_ROLES = ['email_marketer', 'admin'];

/**
 * Gate for the email campaign portal. Must run after authMiddleware.
 *
 * The role is re-read from the database on every request (not trusted from the
 * JWT) so removing someone's access takes effect immediately instead of when
 * their token expires. Only these two roles pass; the existing admin
 * middleware still demands role === 'admin', so an email_marketer account
 * cannot reach any admin endpoint.
 */
module.exports = async (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'firstname', 'lastname', 'email', 'role']
    });

    if (!user || !PORTAL_ROLES.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not have access to the email portal.' });
    }

    req.portalUser = user;
    return next();
  } catch (error) {
    console.error('[EmailPortal] Access check failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not verify portal access' });
  }
};

module.exports.PORTAL_ROLES = PORTAL_ROLES;
