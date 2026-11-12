jest.mock('../config/db', () => ({ query: jest.fn(), define: jest.fn(() => ({ hasMany: jest.fn(), belongsTo: jest.fn() })) }));
jest.mock('../services/staffAccessService', () => ({ getStaffAccess: jest.fn() }));

const { getStaffAccess } = require('../services/staffAccessService');
const requirePermission = require('../middleware/requirePermission');
const { ALL_PERMISSIONS } = require('../config/staffPermissions');
const routeAccess = require('../config/staffRouteAccess');

const respond = () => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
};

const run = async (middleware, req) => {
  const res = respond();
  const next = jest.fn();
  await middleware(req, res, next);
  return { res, next };
};

const staffWith = (...permissions) => ({ hasAccess: true, isSuperAdmin: false, permissions });

describe('requirePermission', () => {
  beforeEach(() => getStaffAccess.mockReset());

  test('an admin passes without any database lookup', async () => {
    const { next } = await run(requirePermission('payouts.approve'), { user: { id: 1, role: 'admin' } });
    expect(next).toHaveBeenCalled();
    expect(getStaffAccess).not.toHaveBeenCalled();
  });

  test('staff with the permission pass', async () => {
    getStaffAccess.mockResolvedValue(staffWith('payouts.view'));
    const { next } = await run(requirePermission('payouts.view'), { user: { id: 2, role: 'viewer' } });
    expect(next).toHaveBeenCalled();
  });

  test('staff without the permission get the same 403 as adminMiddleware', async () => {
    getStaffAccess.mockResolvedValue(staffWith('payouts.view'));
    const { res, next } = await run(requirePermission('payouts.approve'), { user: { id: 2, role: 'viewer' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Access denied. Admin privileges required.' });
  });

  test('a failed lookup denies rather than allows', async () => {
    getStaffAccess.mockRejectedValue(new Error('db down'));
    const { res, next } = await run(requirePermission('payouts.view'), { user: { id: 2, role: 'viewer' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('no user gets a 401', async () => {
    const { res } = await run(requirePermission('payouts.view'), {});
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requirePermission.byRoute', () => {
  const gate = requirePermission.byRoute(routeAccess.ADMIN_ROUTE_PERMISSIONS);
  const staff = { id: 2, role: 'viewer' };
  beforeEach(() => {
    getStaffAccess.mockReset();
    getStaffAccess.mockResolvedValue(staffWith(...ALL_PERMISSIONS));
  });

  test.each([
    ['PATCH', '/users/5/role'],
    ['GET', '/review/queue'],
    ['POST', '/rate-limiter/unblock-user'],
    ['POST', '/withdrawal-limits/admin-override'],
    ['POST', '/audit/log-event'],
    ['POST', '/audit/archive'],
    ['GET', '/something-added-later'],
  ])('%s %s stays admin-only even with every permission', async (method, path) => {
    const { res, next } = await run(gate, { method, path, user: staff });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(getStaffAccess).not.toHaveBeenCalled();
  });

  test.each([
    ['GET', '/dashboard', 'dashboard.view'],
    ['PATCH', '/payouts/9/approve', 'payouts.approve'],
    ['GET', '/course-enrollments/export', 'enrollments.view'],
    ['PATCH', '/course-enrollments/batch-mark-sent', 'enrollments.manage'],
    ['GET', '/audit/logs', 'audit.view'],
  ])('%s %s needs %s', async (method, path, permission) => {
    getStaffAccess.mockResolvedValue(staffWith(permission));
    const { next } = await run(gate, { method, path, user: staff });
    expect(next).toHaveBeenCalled();
  });

  test('admins pass rules that match nothing', async () => {
    const { next } = await run(gate, { method: 'GET', path: '/review/queue', user: { id: 1, role: 'admin' } });
    expect(next).toHaveBeenCalled();
  });
});

describe('permission data', () => {
  const tables = [
    routeAccess.ADMIN_ROUTE_PERMISSIONS,
    routeAccess.COUPON_ROUTE_PERMISSIONS,
    routeAccess.COMMUNITY_ROUTE_PERMISSIONS,
  ];

  test('every rule uses a real permission', () => {
    for (const table of tables) {
      for (const [, , permission] of table) expect(ALL_PERMISSIONS).toContain(permission);
    }
  });

  test.each([
    ['POST', '/campaigns/1/send', 'email.send'],
    ['POST', '/campaigns/1/cancel', 'email.send'],
    ['POST', '/test', 'email.send'],
    ['POST', '/audience/preview', 'email.view'],
    ['GET', '/campaigns', 'email.view'],
    ['POST', '/campaigns', 'email.manage'],
    ['DELETE', '/campaigns/1', 'email.manage'],
  ])('email portal: %s %s needs %s', (method, path, permission) => {
    expect(routeAccess.getEmailPortalPermission(method, path)).toBe(permission);
  });
});
