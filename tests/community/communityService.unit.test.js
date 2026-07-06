'use strict';
/**
 * Unit tests for CommunityService core methods.
 * Uses Jest with manual mocks for Sequelize models.
 */

jest.mock('../../models/Community');
jest.mock('../../models/CommunityMember');
jest.mock('../../models/CommunityAnnouncement');
jest.mock('../../models/CommunityContentSubmission');
jest.mock('../../models/User');
jest.mock('../../models/Video');
jest.mock('../../models/liveClass');
jest.mock('../../models/LiveSeries');
jest.mock('../../models/Freebie');
jest.mock('../../utils/email', () => ({
  sendCommunityStatusEmail: jest.fn().mockResolvedValue(undefined),
  sendCommunityJoinConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendCommunityInviteEmail: jest.fn().mockResolvedValue(undefined),
  sendCommunityAnnouncementEmail: jest.fn().mockResolvedValue(undefined),
  sendCommunityOwnershipTransferEmail: jest.fn().mockResolvedValue(undefined),
  sendCommunityOwnerlessEmail: jest.fn().mockResolvedValue(undefined)
}));
// Must mock config/db before any model is required
jest.mock('../../config/db', () => {
  const { Sequelize } = require('sequelize');
  const instance = new Sequelize('sqlite::memory:', { logging: false });
  instance.transaction = jest.fn(async () => ({
    commit: jest.fn(),
    rollback: jest.fn()
  }));
  return instance;
});

const communityService = require('../../services/communityService');
const Community = require('../../models/Community');
const CommunityMember = require('../../models/CommunityMember');
const User = require('../../models/User');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCommunity(overrides = {}) {
  const obj = {
    id: 'comm-uuid',
    name: 'Test Community',
    status: 'pending',
    visibility: 'public',
    inviteToken: 'a'.repeat(64),
    memberCount: 1,
    createdBy: 1,
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    ...overrides
  };
  return obj;
}

function makeMember(overrides = {}) {
  const obj = {
    id: 'member-uuid',
    communityId: 'comm-uuid',
    userId: 2,
    role: 'member',
    status: 'active',
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    ...overrides
  };
  return obj;
}

// ── createCommunity ───────────────────────────────────────────────────────────

describe('createCommunity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const t = { commit: jest.fn(), rollback: jest.fn() };
    require('../../config/db').transaction.mockResolvedValue(t);
  });

  it('creates community with status=pending', async () => {
    const community = makeCommunity();
    Community.create = jest.fn().mockResolvedValue(community);
    CommunityMember.create = jest.fn().mockResolvedValue({});

    const result = await communityService.createCommunity(1, {
      name: 'Test', type: 'general', visibility: 'public', joinPolicy: 'request'
    });

    expect(Community.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', createdBy: 1 }),
      expect.any(Object)
    );
    expect(result.status).toBe('pending');
  });

  it('creates owner membership record', async () => {
    const community = makeCommunity();
    Community.create = jest.fn().mockResolvedValue(community);
    CommunityMember.create = jest.fn().mockResolvedValue({});

    await communityService.createCommunity(1, {
      name: 'Test', type: 'general', visibility: 'public'
    });

    expect(CommunityMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner', status: 'active', userId: 1 }),
      expect.any(Object)
    );
  });

  it('generates a 64-char hex inviteToken', async () => {
    let capturedData;
    Community.create = jest.fn().mockImplementation(async (data) => {
      capturedData = data;
      return makeCommunity({ inviteToken: data.inviteToken });
    });
    CommunityMember.create = jest.fn().mockResolvedValue({});

    await communityService.createCommunity(1, { name: 'T', type: 'general', visibility: 'public' });

    expect(capturedData.inviteToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── approveCommunity / rejectCommunity / suspendCommunity ─────────────────────

describe('admin status transitions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('approveCommunity sets status=active', async () => {
    const community = makeCommunity();
    Community.findByPk = jest.fn().mockResolvedValue(community);

    await communityService.approveCommunity('comm-uuid');

    expect(community.update).toHaveBeenCalledWith({ status: 'active' });
  });

  it('rejectCommunity sets status=rejected', async () => {
    const community = makeCommunity({ createdBy: 1 });
    Community.findByPk = jest.fn().mockResolvedValue(community);
    User.findByPk = jest.fn().mockResolvedValue({ email: 'a@b.com', firstname: 'A' });

    await communityService.rejectCommunity('comm-uuid');

    expect(community.update).toHaveBeenCalledWith({ status: 'rejected' });
  });

  it('suspendCommunity sets status=suspended', async () => {
    const community = makeCommunity();
    Community.findByPk = jest.fn().mockResolvedValue(community);
    CommunityMember.findOne = jest.fn().mockResolvedValue(null);

    await communityService.suspendCommunity('comm-uuid');

    expect(community.update).toHaveBeenCalledWith({ status: 'suspended' });
  });

  it('throws 404 when community not found', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(null);
    await expect(communityService.approveCommunity('bad-id')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── getCommunityProfile ───────────────────────────────────────────────────────

describe('getCommunityProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 for private community non-member', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity({ visibility: 'private', status: 'active' }));
    CommunityMember.findOne = jest.fn().mockResolvedValue(null);
    require('../../models/Video').findAll = jest.fn().mockResolvedValue([]);
    require('../../models/liveClass').findAll = jest.fn().mockResolvedValue([]);
    require('../../models/LiveSeries').findAll = jest.fn().mockResolvedValue([]);
    require('../../models/Freebie').findAll = jest.fn().mockResolvedValue([]);

    await expect(communityService.getCommunityProfile('comm-uuid', 99, false))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for pending community non-admin', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity({ status: 'pending', visibility: 'public' }));

    await expect(communityService.getCommunityProfile('comm-uuid', 99, false))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for suspended community', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity({ status: 'suspended', visibility: 'public' }));

    await expect(communityService.getCommunityProfile('comm-uuid', 99, false))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

// ── requestJoin ───────────────────────────────────────────────────────────────

describe('requestJoin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates pending membership record', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity({ status: 'active' }));
    CommunityMember.findOne = jest.fn().mockResolvedValue(null);
    CommunityMember.create = jest.fn().mockResolvedValue({ status: 'pending' });

    const result = await communityService.requestJoin('comm-uuid', 5);

    expect(CommunityMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', role: 'member' })
    );
    expect(result.status).toBe('pending');
  });

  it('throws 409 on duplicate pending/active membership', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity({ status: 'active' }));
    CommunityMember.findOne = jest.fn().mockResolvedValue({ status: 'pending' });

    await expect(communityService.requestJoin('comm-uuid', 5))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

// ── approveJoinRequest ────────────────────────────────────────────────────────

describe('approveJoinRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const t = { commit: jest.fn(), rollback: jest.fn() };
    require('../../config/db').transaction.mockResolvedValue(t);
  });

  it('sets member status=active and increments memberCount', async () => {
    const member = makeMember({ status: 'pending' });
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);
    Community.increment = jest.fn().mockResolvedValue([]);
    User.findByPk = jest.fn().mockResolvedValue({ email: 'a@b.com', firstname: 'A' });
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity({ status: 'active' }));

    await communityService.approveJoinRequest('comm-uuid', 2, 1);

    expect(member.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      expect.any(Object)
    );
    expect(Community.increment).toHaveBeenCalledWith('memberCount', expect.any(Object));
  });
});

// ── rejectJoinRequest ─────────────────────────────────────────────────────────

describe('rejectJoinRequest', () => {
  it('sets member status=banned', async () => {
    const member = makeMember({ status: 'pending' });
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);

    await communityService.rejectJoinRequest('comm-uuid', 2, 1);

    expect(member.update).toHaveBeenCalledWith({ status: 'banned' });
  });
});

// ── joinViaInvite ─────────────────────────────────────────────────────────────

describe('joinViaInvite', () => {
  it('throws 404 for invalid token', async () => {
    Community.findOne = jest.fn().mockResolvedValue(null);

    await expect(communityService.joinViaInvite('bad-token', 5))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('creates pending record for valid token', async () => {
    Community.findOne = jest.fn().mockResolvedValue(makeCommunity({ status: 'active' }));
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity({ status: 'active' }));
    CommunityMember.findOne = jest.fn().mockResolvedValue(null);
    CommunityMember.create = jest.fn().mockResolvedValue({ status: 'pending' });

    const result = await communityService.joinViaInvite('a'.repeat(64), 5);

    expect(result.status).toBe('pending');
  });
});

// ── removeMember ──────────────────────────────────────────────────────────────

describe('removeMember', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const t = { commit: jest.fn(), rollback: jest.fn() };
    require('../../config/db').transaction.mockResolvedValue(t);
  });

  it('decrements memberCount', async () => {
    const member = makeMember();
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);
    Community.decrement = jest.fn().mockResolvedValue([]);

    await communityService.removeMember('comm-uuid', 2, 1);

    expect(Community.decrement).toHaveBeenCalledWith('memberCount', expect.any(Object));
    expect(member.destroy).toHaveBeenCalled();
  });
});

// ── assignModerator / revokeModerator ─────────────────────────────────────────

describe('role transitions', () => {
  it('assignModerator sets role=moderator', async () => {
    const member = makeMember({ role: 'member' });
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);

    await communityService.assignModerator('comm-uuid', 2, 1);

    expect(member.update).toHaveBeenCalledWith({ role: 'moderator' });
  });

  it('revokeModerator sets role=member', async () => {
    const member = makeMember({ role: 'moderator' });
    CommunityMember.findOne = jest.fn().mockResolvedValue(member);

    await communityService.revokeModerator('comm-uuid', 2, 1);

    expect(member.update).toHaveBeenCalledWith({ role: 'member' });
  });
});

// ── regenerateInviteToken ─────────────────────────────────────────────────────

describe('regenerateInviteToken', () => {
  it('generates a new token different from the old one', async () => {
    const oldToken = 'b'.repeat(64);
    const community = makeCommunity({ inviteToken: oldToken });
    Community.findByPk = jest.fn().mockResolvedValue(community);
    community.update = jest.fn(async (data) => { community.inviteToken = data.inviteToken; });

    await communityService.regenerateInviteToken('comm-uuid', 1);

    expect(community.update).toHaveBeenCalledWith(
      expect.objectContaining({ inviteToken: expect.stringMatching(/^[0-9a-f]{64}$/) })
    );
    expect(community.inviteToken).not.toBe(oldToken);
  });
});

// ── submitContent ─────────────────────────────────────────────────────────────

describe('submitContent', () => {
  it('creates pending submission with JSONB contentData', async () => {
    const CommunityContentSubmission = require('../../models/CommunityContentSubmission');
    CommunityContentSubmission.create = jest.fn().mockResolvedValue({ status: 'pending', contentData: { title: 'T' } });

    const result = await communityService.submitContent('comm-uuid', 1, {
      contentType: 'video',
      contentData: { title: 'T', price: 1000 },
      communityVisibility: 'community_only'
    });

    expect(CommunityContentSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', contentType: 'video' })
    );
    expect(result.status).toBe('pending');
  });
});

// ── approveSubmission ─────────────────────────────────────────────────────────

describe('approveSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const t = { commit: jest.fn(), rollback: jest.fn() };
    require('../../config/db').transaction.mockResolvedValue(t);
  });

  it('creates content record in correct table and sets submission=approved', async () => {
    const CommunityContentSubmission = require('../../models/CommunityContentSubmission');
    const Video = require('../../models/Video');

    const submission = {
      id: 'sub-uuid',
      status: 'pending',
      contentType: 'video',
      communityId: 'comm-uuid',
      communityVisibility: 'community_only',
      contentData: { title: 'My Video', price: 500 },
      update: jest.fn()
    };
    CommunityContentSubmission.findByPk = jest.fn().mockResolvedValue(submission);
    Video.create = jest.fn().mockResolvedValue({ id: 'vid-uuid' });

    await communityService.approveSubmission('sub-uuid', 1);

    expect(Video.create).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: 'comm-uuid' }),
      expect.any(Object)
    );
    expect(submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
      expect.any(Object)
    );
  });
});

// ── rejectSubmission ──────────────────────────────────────────────────────────

describe('rejectSubmission', () => {
  it('sets status=rejected and stores rejectionReason', async () => {
    const CommunityContentSubmission = require('../../models/CommunityContentSubmission');
    const submission = { id: 'sub-uuid', status: 'pending', update: jest.fn() };
    CommunityContentSubmission.findByPk = jest.fn().mockResolvedValue(submission);

    await communityService.rejectSubmission('sub-uuid', 1, 'Does not meet guidelines');

    expect(submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', rejectionReason: 'Does not meet guidelines' })
    );
  });

  it('throws 400 when rejection reason is empty', async () => {
    await expect(communityService.rejectSubmission('sub-uuid', 1, ''))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(communityService.rejectSubmission('sub-uuid', 1, null))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── resubmitContent ───────────────────────────────────────────────────────────

describe('resubmitContent', () => {
  it('sets status=resubmitted and updates contentData', async () => {
    const CommunityContentSubmission = require('../../models/CommunityContentSubmission');
    const submission = { id: 'sub-uuid', status: 'rejected', submittedBy: 1, update: jest.fn() };
    CommunityContentSubmission.findByPk = jest.fn().mockResolvedValue(submission);

    await communityService.resubmitContent('sub-uuid', 1, { contentData: { title: 'Updated' } });

    expect(submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resubmitted', contentData: { title: 'Updated' } })
    );
  });
});

// ── createContentDirect ───────────────────────────────────────────────────────

describe('createContentDirect', () => {
  it('creates content record immediately without submission', async () => {
    const Video = require('../../models/Video');
    Video.create = jest.fn().mockResolvedValue({ id: 'vid-uuid', communityId: 'comm-uuid' });
    const CommunityContentSubmission = require('../../models/CommunityContentSubmission');
    CommunityContentSubmission.create = jest.fn();

    const result = await communityService.createContentDirect('comm-uuid', 1, 'video', { title: 'Direct' });

    expect(Video.create).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: 'comm-uuid' })
    );
    expect(CommunityContentSubmission.create).not.toHaveBeenCalled();
    expect(result.communityId).toBe('comm-uuid');
  });
});

// ── deleteCommunity (owner) ───────────────────────────────────────────────────

describe('deleteCommunity (owner)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 409 when active members exist', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity());
    CommunityMember.findOne = jest.fn().mockResolvedValue({ role: 'owner', status: 'active' });
    CommunityMember.count = jest.fn().mockResolvedValue(2); // other active members
    require('../../models/Video').count = jest.fn().mockResolvedValue(0);
    require('../../models/liveClass').count = jest.fn().mockResolvedValue(0);
    require('../../models/LiveSeries').count = jest.fn().mockResolvedValue(0);
    require('../../models/Freebie').count = jest.fn().mockResolvedValue(0);

    await expect(communityService.deleteCommunity('comm-uuid', 1))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws 409 when content records exist', async () => {
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity());
    CommunityMember.findOne = jest.fn().mockResolvedValue({ role: 'owner', status: 'active' });
    CommunityMember.count = jest.fn().mockResolvedValue(0);
    require('../../models/Video').count = jest.fn().mockResolvedValue(3);
    require('../../models/liveClass').count = jest.fn().mockResolvedValue(0);
    require('../../models/LiveSeries').count = jest.fn().mockResolvedValue(0);
    require('../../models/Freebie').count = jest.fn().mockResolvedValue(0);

    await expect(communityService.deleteCommunity('comm-uuid', 1))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

// ── ownerLeave ────────────────────────────────────────────────────────────────

describe('ownerLeave', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const t = { commit: jest.fn(), rollback: jest.fn() };
    require('../../config/db').transaction.mockResolvedValue(t);
  });

  it('deletes community when no other members and no content', async () => {
    const ownerMember = makeMember({ role: 'owner', userId: 1 });
    CommunityMember.findOne = jest.fn()
      .mockResolvedValueOnce(ownerMember)   // ownerMember lookup
      .mockResolvedValueOnce(null);          // no earliest moderator
    CommunityMember.count = jest.fn().mockResolvedValue(0);
    require('../../models/Video').count = jest.fn().mockResolvedValue(0);
    require('../../models/liveClass').count = jest.fn().mockResolvedValue(0);
    require('../../models/LiveSeries').count = jest.fn().mockResolvedValue(0);
    require('../../models/Freebie').count = jest.fn().mockResolvedValue(0);
    Community.destroy = jest.fn().mockResolvedValue(1);

    await communityService.ownerLeave('comm-uuid', 1);

    expect(Community.destroy).toHaveBeenCalled();
  });

  it('transfers ownership to earliest moderator', async () => {
    const ownerMember = makeMember({ role: 'owner', userId: 1 });
    const moderatorMember = makeMember({ role: 'moderator', userId: 3 });
    CommunityMember.findOne = jest.fn()
      .mockResolvedValueOnce(ownerMember)
      .mockResolvedValueOnce(moderatorMember);
    CommunityMember.count = jest.fn().mockResolvedValue(2);
    require('../../models/Video').count = jest.fn().mockResolvedValue(0);
    require('../../models/liveClass').count = jest.fn().mockResolvedValue(0);
    require('../../models/LiveSeries').count = jest.fn().mockResolvedValue(0);
    require('../../models/Freebie').count = jest.fn().mockResolvedValue(0);
    Community.decrement = jest.fn().mockResolvedValue([]);
    User.findByPk = jest.fn().mockResolvedValue({ email: 'mod@b.com', firstname: 'Mod' });
    Community.findByPk = jest.fn().mockResolvedValue(makeCommunity());

    await communityService.ownerLeave('comm-uuid', 1);

    expect(moderatorMember.update).toHaveBeenCalledWith({ role: 'owner' }, expect.any(Object));
    expect(ownerMember.destroy).toHaveBeenCalled();
  });

  it('sets community status=pending when no moderators but members exist', async () => {
    const ownerMember = makeMember({ role: 'owner', userId: 1 });
    CommunityMember.findOne = jest.fn()
      .mockResolvedValueOnce(ownerMember)
      .mockResolvedValueOnce(null); // no moderator
    CommunityMember.count = jest.fn().mockResolvedValue(2);
    require('../../models/Video').count = jest.fn().mockResolvedValue(0);
    require('../../models/liveClass').count = jest.fn().mockResolvedValue(0);
    require('../../models/LiveSeries').count = jest.fn().mockResolvedValue(0);
    require('../../models/Freebie').count = jest.fn().mockResolvedValue(0);
    Community.update = jest.fn().mockResolvedValue([]);
    Community.decrement = jest.fn().mockResolvedValue([]);
    User.findAll = jest.fn().mockResolvedValue([]);

    await communityService.ownerLeave('comm-uuid', 1);

    expect(Community.update).toHaveBeenCalledWith(
      { status: 'pending' },
      expect.objectContaining({ where: { id: 'comm-uuid' } })
    );
  });
});
