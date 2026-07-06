'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/communityController');
const authMiddleware = require('../middleware/authMiddleware');
const communityMemberMiddleware = require('../middleware/communityMemberMiddleware');
const communityModeratorMiddleware = require('../middleware/communityModeratorMiddleware');
const { upload } = require('../utils/multerConfig');

// Optional auth — sets req.user if token present, continues either way
const optionalAuth = (req, res, next) => {
  const jwt = require('jsonwebtoken');
  let token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token && req.cookies && req.cookies.token) token = req.cookies.token;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET_KEY);
    } catch (_) { /* invalid token — treat as unauthenticated */ }
  }
  next();
};

// ── Public (no auth required) ────────────────────────────────────────────────
router.get('/', ctrl.listCommunities);
router.get('/invite/:token', authMiddleware, ctrl.joinViaInvite);

// ── Auth required (no membership check) ─────────────────────────────────────
router.post('/', authMiddleware, upload.fields([{ name: 'poster', maxCount: 1 }]), ctrl.createCommunity);
router.get('/my', authMiddleware, ctrl.getMyCommunities);
router.post('/:id/join', authMiddleware, ctrl.requestJoin);

// ── Community profile (optional auth — handled inside service) ───────────────
router.get('/:id', optionalAuth, ctrl.getCommunity);

// ── Member routes ────────────────────────────────────────────────────────────
router.delete('/:id/members/me', authMiddleware, communityMemberMiddleware, ctrl.leaveCommunity);
router.patch('/:id/members/me/notifications', authMiddleware, communityMemberMiddleware, ctrl.toggleNotifications);
router.get('/:id/announcements', authMiddleware, communityMemberMiddleware, ctrl.listAnnouncements);
router.get('/:id/content', authMiddleware, communityMemberMiddleware, ctrl.listContent);
router.post('/:id/submissions', authMiddleware, communityMemberMiddleware, ctrl.submitContent);
router.get('/:id/submissions/my', authMiddleware, communityMemberMiddleware, ctrl.listMySubmissions);
router.patch('/:id/submissions/:sid/resubmit', authMiddleware, communityMemberMiddleware, ctrl.resubmitContent);
router.get('/:id/members/:uid', authMiddleware, communityMemberMiddleware, ctrl.getMemberProfile);

// ── Announcement interactions (all members) ──────────────────────────────────
router.post('/:id/announcements/:aid/like', authMiddleware, communityMemberMiddleware, ctrl.toggleAnnouncementLike);
router.get('/:id/announcements/:aid/comments', authMiddleware, communityMemberMiddleware, ctrl.listAnnouncementComments);
router.post('/:id/announcements/:aid/comments', authMiddleware, communityMemberMiddleware, ctrl.addAnnouncementComment);
router.delete('/:id/announcements/:aid/comments/:cid', authMiddleware, communityMemberMiddleware, ctrl.deleteAnnouncementComment);

// ── Moderator routes ─────────────────────────────────────────────────────────
router.get('/:id/members', authMiddleware, communityModeratorMiddleware, ctrl.listMembers);
router.post('/:id/members', authMiddleware, communityModeratorMiddleware, ctrl.addMember);
router.delete('/:id/members/:uid', authMiddleware, communityModeratorMiddleware, ctrl.removeMember);
router.get('/:id/submissions', authMiddleware, communityModeratorMiddleware, ctrl.listSubmissions);
router.post('/:id/submissions/:sid/approve', authMiddleware, communityModeratorMiddleware, ctrl.approveSubmission);
router.post('/:id/submissions/:sid/reject', authMiddleware, communityModeratorMiddleware, ctrl.rejectSubmission);
router.post('/:id/announcements', authMiddleware, communityModeratorMiddleware, upload.fields([{ name: 'image', maxCount: 1 }]), ctrl.createAnnouncement);
router.patch('/:id/announcements/:aid', authMiddleware, communityModeratorMiddleware, ctrl.updateAnnouncement);
router.delete('/:id/announcements/:aid', authMiddleware, communityModeratorMiddleware, ctrl.deleteAnnouncement);
router.get('/:id/invite', authMiddleware, communityModeratorMiddleware, ctrl.getInviteLink);
router.post('/:id/invite/regenerate', authMiddleware, communityModeratorMiddleware, ctrl.regenerateInvite);
router.post('/:id/content', authMiddleware, communityModeratorMiddleware, ctrl.createContentDirect);
router.post('/:id/join-requests/:uid/approve', authMiddleware, communityModeratorMiddleware, ctrl.approveJoinRequest);
router.post('/:id/join-requests/:uid/reject', authMiddleware, communityModeratorMiddleware, ctrl.rejectJoinRequest);

// ── Owner routes (role enforced in service layer) ────────────────────────────
router.patch('/:id', authMiddleware, communityMemberMiddleware, upload.fields([{ name: 'poster', maxCount: 1 }]), ctrl.updateCommunity);
router.patch('/:id/members/:uid/role', authMiddleware, communityMemberMiddleware, ctrl.updateMemberRole);
router.delete('/:id', authMiddleware, communityMemberMiddleware, ctrl.deleteCommunity);
router.post('/:id/transfer-ownership', authMiddleware, communityMemberMiddleware, ctrl.transferOwnership);

module.exports = router;
