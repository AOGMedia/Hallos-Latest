'use strict';
jest.mock('../../models/CommunityMember');

const CommunityMember = require('../../models/CommunityMember');
const communityMemberMiddleware = require('../../middleware/communityMemberMiddleware');
const communityModeratorMiddleware = require('../../middleware/communityModeratorMiddleware');

function makeReq(overrides = {}) {
  return {
    params: { id: 'comm-uuid' },
    user: { id: 1, role: 'user' },
    ...overrides
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ── communityMemberMiddleware ─────────────────────────────────────────────────

describe('communityMemberMiddleware', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls next() for active member', async () => {
    const member = { communityId: 'comm-uuid', userId: 1, role: 'member', status: 'active' };
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await communityMemberMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.communityMember).toBe(member);
  });

  it('returns 403 for non-member', async () => {
    CommunityMember.findOne = jest.fn().mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await communityMemberMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('bypasses check for platform admin', async () => {
    const req = makeReq({ user: { id: 1, role: 'admin' } });
    const res = makeRes();
    const next = jest.fn();

    await communityMemberMiddleware(req, res, next);

    expect(CommunityMember.findOne).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

// ── communityModeratorMiddleware ──────────────────────────────────────────────

describe('communityModeratorMiddleware', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 403 for member role', async () => {
    CommunityMember.findOne = jest.fn().mockResolvedValue({ role: 'member', status: 'active' });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await communityModeratorMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for moderator role', async () => {
    const member = { role: 'moderator', status: 'active' };
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await communityModeratorMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next() for owner role', async () => {
    const member = { role: 'owner', status: 'active' };
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await communityModeratorMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('bypasses check for platform admin', async () => {
    const req = makeReq({ user: { id: 1, role: 'admin' } });
    const res = makeRes();
    const next = jest.fn();

    await communityModeratorMiddleware(req, res, next);

    expect(CommunityMember.findOne).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
