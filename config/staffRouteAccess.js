/**
 * Which staff permission opens which route, for routers that protect every
 * route with a single router.use(). Each rule is [method, path regex, permission].
 *
 * A request that matches no rule stays admin-only, so anything new or unusual
 * fails closed for staff and is unaffected for admins.
 */
const ADMIN_ROUTE_PERMISSIONS = [
  ['GET', /^\/dashboard\/?$/, 'dashboard.view'],
  ['GET', /^\/revenue\/?$/, 'dashboard.view'],
  ['GET', /^\/content-stats\/?$/, 'dashboard.view'],

  ['GET', /^\/users\/?$/, 'users.view'],
  ['GET', /^\/users\/[^/]+\/?$/, 'users.view'],
  ['GET', /^\/users\/[^/]+\/(overview|activity)\/?$/, 'users.view'],
  ['POST', /^\/users\/[^/]+\/email\/?$/, 'users.email'],
  ['POST', /^\/users\/[^/]+\/wallet-adjustments\/?$/, 'users.wallet'],

  ['GET', /^\/live\/(overview|classes|series)\/?$/, 'live.view'],
  ['GET', /^\/live\/(classes|series)\/[^/]+\/?$/, 'live.view'],
  ['POST', /^\/live\/(classes|sessions)\/[^/]+\/end\/?$/, 'live.manage'],
  ['GET', /^\/payouts\/?$/, 'payouts.view'],
  ['PATCH', /^\/payouts\/[^/]+\/(approve|reject)\/?$/, 'payouts.approve'],

  ['GET', /^\/course-enrollments(\/[^/]+)?\/?$/, 'enrollments.view'],
  ['PATCH', /^\/course-enrollments\/[^/]+\/mark-sent\/?$/, 'enrollments.manage'],
  ['PATCH', /^\/course-enrollments\/batch-mark-sent\/?$/, 'enrollments.manage'],

  ['GET', /^\/transactions\/[^/]+\/?$/, 'transactions.view'],
  ['POST', /^\/transactions\/search\/?$/, 'transactions.view'],

  ['GET', /^\/fraud-detection\/(stats|config|suspicious-activities)\/?$/, 'security.view'],
  ['GET', /^\/fraud-detection\/user\/[^/]+\/?$/, 'security.view'],
  ['GET', /^\/withdrawal-limits\/system-stats\/?$/, 'security.view'],
  ['GET', /^\/withdrawal-limits\/user\/[^/]+\/?$/, 'security.view'],
  ['POST', /^\/fraud-detection\/unblock-user\/?$/, 'security.manage'],
  ['POST', /^\/withdrawal-limits\/set-tier\/?$/, 'security.manage'],
  ['POST', /^\/withdrawal-limits\/(suspend|restore)-user\/?$/, 'security.manage'],

  ['GET', /^\/audit\/(logs|stats)\/?$/, 'audit.view'],
];

/**
 * Mounted after /api/admin in server.js, so their requests pass through the
 * admin router first. Each of these routers enforces its own permissions.
 */
const ADMIN_DELEGATED_PATHS = /^\/(coupons|communities|live-series)(\/|$)/;

const COUPON_ROUTE_PERMISSIONS = [
  ['GET', /^\/?$/, 'coupons.view'],
  ['GET', /^\/analytics\/?$/, 'coupons.view'],
  ['GET', /^\/[^/]+\/usage-history\/?$/, 'coupons.view'],
  ['POST', /^\/create\/?$/, 'coupons.manage'],
  ['PUT', /^\/[^/]+\/?$/, 'coupons.manage'],
  ['DELETE', /^\/[^/]+\/?$/, 'coupons.manage'],
  ['DELETE', /^\/[^/]+\/permanent\/?$/, 'coupons.manage'],
];

const COMMUNITY_ROUTE_PERMISSIONS = [
  ['GET', /^\/?$/, 'communities.view'],
  ['GET', /^\/[^/]+\/members\/?$/, 'communities.view'],
  ['POST', /^\/[^/]+\/(approve|reject|suspend)\/?$/, 'communities.manage'],
  ['DELETE', /^\/[^/]+\/members\/[^/]+\/?$/, 'communities.manage'],
  ['DELETE', /^\/[^/]+\/?$/, 'communities.manage'],
  ['DELETE', /^\/[^/]+\/content\/[^/]+\/?$/, 'communities.manage'],
];

/** Sending and anything that reads the audience are split out from editing. */
function getEmailPortalPermission(method, path) {
  if (/^\/(test|campaigns\/[^/]+\/(send|cancel|retry-failed))\/?$/.test(path)) return 'email.send';
  if (/^\/audience\/(preview|users)\/?$/.test(path)) return 'email.view';
  return method === 'GET' ? 'email.view' : 'email.manage';
}

module.exports = {
  ADMIN_ROUTE_PERMISSIONS,
  ADMIN_DELEGATED_PATHS,
  COUPON_ROUTE_PERMISSIONS,
  COMMUNITY_ROUTE_PERMISSIONS,
  getEmailPortalPermission,
};
