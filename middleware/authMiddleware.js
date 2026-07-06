const jwt = require('jsonwebtoken');
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
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token.' });
  }
};