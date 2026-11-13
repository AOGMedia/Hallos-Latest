const jwt = require('jsonwebtoken');
const { isSuspended, suspendedResponse } = require('../services/suspensionService');
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
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token.' });
  }
};