'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminCommunityController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePermission = require('../middleware/requirePermission');
const { COMMUNITY_ROUTE_PERMISSIONS } = require('../config/staffRouteAccess');

router.use(authMiddleware);
router.use(requirePermission.byRoute(COMMUNITY_ROUTE_PERMISSIONS));

router.get('/', ctrl.listAllCommunities);
router.post('/:id/approve', ctrl.approveCommunity);
router.post('/:id/reject', ctrl.rejectCommunity);
router.post('/:id/suspend', ctrl.suspendCommunity);
router.get('/:id/members', ctrl.listMembers);
router.delete('/:id/members/:uid', ctrl.removeMember);
router.delete('/:id', ctrl.deleteCommunity);
router.delete('/:id/content/:contentId', ctrl.deleteContent);

module.exports = router;
