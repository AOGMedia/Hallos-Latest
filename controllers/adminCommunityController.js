'use strict';
const communityService = require('../services/communityService');
const CommunityMember = require('../models/CommunityMember');
const User = require('../models/User');

function handleError(res, err) {
  const status = err.statusCode || 500;
  return res.status(status).json({ success: false, message: err.message });
}

// GET /api/admin/communities
exports.listAllCommunities = async (req, res) => {
  try {
    const result = await communityService.listAllCommunities(req.query);
    res.json({ success: true, data: result });
  } catch (err) { handleError(res, err); }
};

// POST /api/admin/communities/:id/approve
exports.approveCommunity = async (req, res) => {
  try {
    const community = await communityService.approveCommunity(req.params.id);
    res.json({ success: true, data: community });
  } catch (err) { handleError(res, err); }
};

// POST /api/admin/communities/:id/reject
exports.rejectCommunity = async (req, res) => {
  try {
    const community = await communityService.rejectCommunity(req.params.id);
    res.json({ success: true, data: community });
  } catch (err) { handleError(res, err); }
};

// POST /api/admin/communities/:id/suspend
exports.suspendCommunity = async (req, res) => {
  try {
    const community = await communityService.suspendCommunity(req.params.id);
    res.json({ success: true, data: community });
  } catch (err) { handleError(res, err); }
};

// GET /api/admin/communities/:id/members
exports.listMembers = async (req, res) => {
  try {
    const members = await CommunityMember.findAll({
      where: { communityId: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }]
    });
    res.json({ success: true, data: members });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/admin/communities/:id/members/:uid
exports.removeMember = async (req, res) => {
  try {
    await communityService.removeMember(req.params.id, parseInt(req.params.uid), req.user.id);
    res.json({ success: true, message: 'Member removed.' });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/admin/communities/:id
exports.deleteCommunity = async (req, res) => {
  try {
    await communityService.adminDeleteCommunity(req.params.id);
    res.json({ success: true, message: 'Community deleted.' });
  } catch (err) { handleError(res, err); }
};

// DELETE /api/admin/communities/:id/content/:contentId
exports.deleteContent = async (req, res) => {
  try {
    const { contentType } = req.query;
    if (!contentType) return res.status(400).json({ success: false, message: 'contentType query param required.' });
    await communityService.adminDeleteContent(req.params.id, req.params.contentId, contentType);
    res.json({ success: true, message: 'Content deleted.' });
  } catch (err) { handleError(res, err); }
};
