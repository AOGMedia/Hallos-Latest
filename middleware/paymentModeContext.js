const jwt = require('jsonwebtoken');
const gatewayMode = require('../services/gatewayModeService');

/**
 * Marks buyer checkout requests, so payment test accounts and gateways
 * switched to test mode use the test keys there — and only there. Every other
 * request (payouts, withdrawals, admin, everything else) keeps the live keys.
 *
 * It only reads who is asking; signing in is still checked by authMiddleware
 * on each route. A missing or bad token just means "not a test account".
 */
const CHECKOUT_PATHS = [
  /^\/api\/payments\/initialize\/?$/,
  /^\/api\/payments\/verify\/[^/]+\/?$/,
  /^\/api\/freebies\/[^/]+\/purchase\/?$/,
  /^\/api\/wallet\/topup\/(initialize|verify)\/?$/,
  /^\/api\/courses\/purchase\/?$/,
  /^\/api\/campaigns\/register\/?$/,
];

function userIdFrom(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET_KEY)?.id ?? null;
  } catch {
    return null;
  }
}

module.exports = function paymentModeContext(req, res, next) {
  if (!gatewayMode.isReady() || !CHECKOUT_PATHS.some((pattern) => pattern.test(req.path))) return next();
  return gatewayMode.runCheckout(userIdFrom(req), next);
};
