const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { getStaffAccess } = require('../services/staffAccessService');
const alerts = require('../services/staffAlertService');

/**
 * /api/staff-alerts: each staff member's own email alert settings.
 * Open to super admins and any staff member; each only sees and changes their
 * own, and only alerts their role includes.
 */
const router = express.Router();

async function staffOnly(req, res, next) {
  try {
    const access = await getStaffAccess(req.user.id);
    if (!access?.hasAccess || (!access.isSuperAdmin && access.permissions.length === 0)) {
      return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
    }
    req.staffAccess = access;
    return next();
  } catch (error) {
    console.error('[Staff alerts] Access check failed:', error.message);
    return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
  }
}

const fail = (res, error) => {
  if (error instanceof alerts.StaffAlertError) return res.status(error.status).json({ success: false, message: error.message });
  console.error('[Staff alerts] Request failed:', error);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

router.get('/', authMiddleware, staffOnly, async (req, res) => {
  try {
    return res.json({ success: true, data: { quietMinutes: alerts.QUIET_MINUTES, alerts: await alerts.settingsFor(req.staffAccess, req.user.id) } });
  } catch (error) {
    return fail(res, error);
  }
});

router.put('/:key', authMiddleware, staffOnly, async (req, res) => {
  try {
    const list = await alerts.setEnabled(req.staffAccess, req.user.id, req.params.key, req.body?.enabled === true);
    return res.json({ success: true, data: { quietMinutes: alerts.QUIET_MINUTES, alerts: list } });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
