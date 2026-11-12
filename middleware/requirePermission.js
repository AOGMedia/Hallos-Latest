const { getStaffAccess } = require('../services/staffAccessService');

/**
 * Lets a request through for an admin, or for staff holding the permission.
 * Must run after authMiddleware.
 *
 * Admins take exactly the path adminMiddleware always gave them: the role in
 * their token, no database call. Everything else fails closed, with the same
 * response adminMiddleware sends.
 */
const deny = (res) =>
  res.status(403).json({
    success: false,
    message: 'Access denied. Admin privileges required.',
  });

async function check(req, res, next, permission) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role === 'admin') return next();
  if (!permission) return deny(res);

  try {
    const access = await getStaffAccess(req.user.id);
    return access.permissions.includes(permission) ? next() : deny(res);
  } catch (error) {
    console.error('[requirePermission] Access check failed:', error.message);
    return deny(res);
  }
}

/** Guards one route with one permission. */
const requirePermission = (permission) => (req, res, next) =>
  check(req, res, next, permission);

/**
 * Guards a whole router from a rule table. Unmatched requests stay admin-only.
 * `delegatedPaths` belong to routers mounted further down the same URL, which
 * run their own auth and permission checks, so they are passed along untouched.
 */
requirePermission.byRoute = (rules, { delegatedPaths = null } = {}) => (req, res, next) => {
  if (delegatedPaths && delegatedPaths.test(req.path)) return next();

  const rule = rules.find(
    ([method, pattern]) => method === req.method && pattern.test(req.path)
  );
  return check(req, res, next, rule ? rule[2] : null);
};

module.exports = requirePermission;
