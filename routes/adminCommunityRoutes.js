'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminCommunityController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/', ctrl.listAllCommunities);
router.post('/:id/approve', ctrl.approveCommunity);
router.post('/:id/reject', ctrl.rejectCommunity);
router.post('/:id/suspend', ctrl.suspendCommunity);
router.get('/:id/members', ctrl.listMembers);
router.delete('/:id/members/:uid', ctrl.removeMember);
router.delete('/:id', ctrl.deleteCommunity);
router.delete('/:id/content/:contentId', ctrl.deleteContent);

module.exports = router;
