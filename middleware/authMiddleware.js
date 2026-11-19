const jwt = require('jsonwebtoken');
const { isSuspended, suspendedResponse } = require('../services/suspensionService');
const { isDeleted, deletedResponse } = require('../services/accountDeletionService');
const { noteActive } = require('../services/activityTrackingService');
const { isSessionEnded } = require('../services/staffLoginService');
const SECRET_KEY = process.env.JWT_SECRET_KEY;

module.exports = (req, res, next) => {
  // Try header first
  let token = req.header('Authorization')?.replace('Bearer ', '');
  // If not in header, try cookie
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Access denied, token missing.' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    // In-memory lookup; see services/suspensionService.
    if (isSuspended(decoded.id)) return res.status(403).json(suspendedResponse(decoded.id));
    // Deleted accounts: old sign-ins stop working at once (401 signs the site and app out).
    if (isDeleted(decoded.id)) return res.status(401).json(deletedResponse());
    // Staff whose password was reset or whose login was turned off: earlier sign-ins end (in-memory check).
    if (isSessionEnded(decoded.id, decoded.iat, decoded.ts)) {
      return res.status(401).json({ message: 'Your session ended. Please sign in again.', code: 'SESSION_ENDED' });
    }
    req.user = decoded;
    // Counts this person as active today (one write per person per day; never throws).
    noteActive(decoded.id);
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token.' });
  }
};