'use strict';
/**
 * Integration tests for community routes.
 * Uses supertest against the Express app with mocked service layer.
 */

jest.mock('../../services/communityService');
jest.mock('../../middleware/authMiddleware', () => (req, res, next) => {
  req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : null;
  if (!req.user) return res.status(401).json({ message: 'Access denied, token missing.' });
  next();
});
jest.mock('../../middleware/communityMemberMiddleware', () => async (req, res, next) => {
  if (req.headers['x-test-member'] === 'false') {
    return res.status(403).json({ message: 'Community membership required.' });
  }
  req.communityMember = { role: req.headers['x-test-role'] || 'member', status: 'active' };
  next();
});
jest.mock('../../middleware/communityModeratorMiddleware', () => async (req, res, next) => {
  if (req.headers['x-test-role'] === 'member') {
    return res.status(403).json({ message: 'Moderator or owner role required.' });
  }
  req.communityMember = { role: req.headers['x-test-role'] || 'moderator', status: 'active' };
  next();
});
jest.mock('../../middleware/adminMiddleware', () => (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin privileges required.' });
  }
  next();
});

// Must mock config/db before any model/route is required
jest.mock('../../config/db', () => {
  const { Sequelize } = require('sequelize');
  return new Sequelize('sqlite::memory:', { logging: false });
});
jest.mock('../../models/communityIndex', () => ({}));
jest.mock('../../models/CommunityMember', () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock('../../models/Community', () => ({}));
jest.mock('../../models/CommunityContentSubmission', () => ({}));
jest.mock('../../models/User', () => ({}));
jest.mock('../../models/Video', () => ({}));
jest.mock('../../models/liveClass', () => ({}));
jest.mock('../../models/LiveSeries', () => ({}));
jest.mock('../../models/Freebie', () => ({}));

const request = require('supertest');
const express = require('express');
const communityRoutes = require('../../routes/communityRoutes');
const adminCommunityRoutes = require('../../routes/adminCommunityRoutes');
const communityService = require('../../services/communityService');

const app = express();
app.use(express.json());
app.use('/api/communities', communityRoutes);
app.use('/api/admin/communities', adminCommunityRoutes);

const adminUser = JSON.stringify({ id: 1, role: 'admin' });
const regularUser = JSON.stringify({ id: 2, role: 'user' });

// ── POST /api/communities ─────────────────────────────────────────────────────

describe('POST /api/communities', () => {
  it('returns 201 with pending status', async () => {
    communityService.createCommunity = jest.fn().mockResolvedValue({
      id: 'uuid', name: 'Test', status: 'pending', inviteToken: 'tok'
    });

    const res = await request(app)
      .post('/api/communities')
      .set('x-test-user', regularUser)
      .send({ name: 'Test', type: 'general', visibility: 'public' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
  });
});

// ── GET /api/communities ──────────────────────────────────────────────────────

describe('GET /api/communities', () => {
  it('returns only active+public communities', async () => {
    communityService.listPublicCommunities = jest.fn().mockResolvedValue({
      total: 1, communities: [{ id: 'uuid', status: 'active', visibility: 'public' }]
    });

    const res = await request(app).get('/api/communities');

    expect(res.status).toBe(200);
    expect(res.body.data.communities[0].status).toBe('active');
  });
});

// ── GET /api/communities/:id ──────────────────────────────────────────────────

describe('GET /api/communities/:id', () => {
  it('returns 404 for private community non-member', async () => {
    communityService.getCommunityProfile = jest.fn().mockRejectedValue(
      Object.assign(new Error('Community not found.'), { statusCode: 404 })
    );

    const res = await request(app).get('/api/communities/some-id');

    expect(res.status).toBe(404);
  });

  it('returns 200 for public community', async () => {
    communityService.getCommunityProfile = jest.fn().mockResolvedValue({
      community: { id: 'uuid', visibility: 'public' }, isMember: false, publicContent: {}
    });

    const res = await request(app).get('/api/communities/some-id');

    expect(res.status).toBe(200);
  });
});

// ── POST /api/communities/:id/join ────────────────────────────────────────────

describe('POST /api/communities/:id/join', () => {
  it('returns 201 with pending record', async () => {
    communityService.requestJoin = jest.fn().mockResolvedValue({ status: 'pending' });

    const res = await request(app)
      .post('/api/communities/comm-id/join')
      .set('x-test-user', regularUser);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 409 on duplicate join', async () => {
    communityService.requestJoin = jest.fn().mockRejectedValue(
      Object.assign(new Error('Already a member.'), { statusCode: 409 })
    );

    const res = await request(app)
      .post('/api/communities/comm-id/join')
      .set('x-test-user', regularUser);

    expect(res.status).toBe(409);
  });
});

// ── GET /api/communities/invite/:token ────────────────────────────────────────

describe('GET /api/communities/invite/:token', () => {
  it('returns 404 for invalid token', async () => {
    communityService.joinViaInvite = jest.fn().mockRejectedValue(
      Object.assign(new Error('Invalid invite link.'), { statusCode: 404 })
    );

    const res = await request(app)
      .get('/api/communities/invite/bad-token')
      .set('x-test-user', regularUser);

    expect(res.status).toBe(404);
  });
});

// ── Admin routes ──────────────────────────────────────────────────────────────

describe('Admin routes', () => {
  it('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/admin/communities')
      .set('x-test-user', regularUser);

    expect(res.status).toBe(403);
  });

  it('returns 200 for admin user', async () => {
    communityService.listAllCommunities = jest.fn().mockResolvedValue({ total: 0, communities: [] });

    const res = await request(app)
      .get('/api/admin/communities')
      .set('x-test-user', adminUser);

    expect(res.status).toBe(200);
  });
});

// ── Moderator routes ──────────────────────────────────────────────────────────

describe('Moderator routes', () => {
  it('returns 403 for member role', async () => {
    const res = await request(app)
      .get('/api/communities/comm-id/members')
      .set('x-test-user', regularUser)
      .set('x-test-role', 'member');

    expect(res.status).toBe(403);
  });

  it('returns 200 for moderator role', async () => {
    const res = await request(app)
      .get('/api/communities/comm-id/members')
      .set('x-test-user', regularUser)
      .set('x-test-role', 'moderator');

    expect(res.status).toBe(200);
  });
});
