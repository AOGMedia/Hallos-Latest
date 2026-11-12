const User = require('../models/User');

/**
 * Gate for granting access. Checks the database, not the token, so someone
 * demoted from admin can't keep handing out roles until their token expires.
 * Must run after authMiddleware.
 */
module.exports = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: ['id', 'role'] });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only a super admin can do this.' });
    }
    return next();
  } catch (error) {
    console.error('[requireSuperAdmin] Access check failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not verify access' });
  }
};
