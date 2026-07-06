const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

module.exports = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: { success: false, message: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || '127.0.0.1';
    return ipKeyGenerator(ip);
  }
});
