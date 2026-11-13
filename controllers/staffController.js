const service = require('../services/staffManagementService');
const { getStaffAccess } = require('../services/staffAccessService');
const { PERMISSION_GROUPS } = require('../config/staffPermissions');

const handle = (action, status = 200) => async (req, res) => {
  try {
    const data = await action(req);
    return res.status(status).json({ success: true, data: data ?? null });
  } catch (error) {
    if (error instanceof service.StaffError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Staff] Request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

/** The signed-in person's own access. Staff apps build their menus from this. */
exports.me = async (req, res) => {
  try {
    const access = await getStaffAccess(req.user.id);
    if (!access.hasAccess) {
      return res.status(403).json({ success: false, message: 'This account doesn’t have access.' });
    }
    return res.status(200).json({ success: true, data: access });
  } catch (error) {
    console.error('[Staff] Access lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not verify access' });
  }
};

exports.permissions = handle(async () => PERMISSION_GROUPS);

exports.listRoles = handle(() => service.listRoles());
exports.createRole = handle((req) => service.createRole(req.body, req.user.id), 201);
exports.updateRole = handle((req) => service.updateRole(req.params.id, req.body));
exports.deleteRole = handle((req) => service.deleteRole(req.params.id));

exports.listStaff = handle(() => service.listStaff());
exports.addMember = handle((req) => service.addMember(req.body, req.user.id), 201);
exports.updateMemberRole = handle((req) =>
  service.updateMemberRole(req.params.userId, req.body.roleId, req.user.id)
);
exports.removeMember = handle((req) => service.removeMember(req.params.userId));
exports.resendInvite = handle((req) => service.resendInvite(req.params.userId));

exports.setPassword = handle((req) =>
  service.setPasswordFromInvite(req.body.token, req.body.password)
);

/** Everything staff changed, newest first. Super admins only. */
exports.activity = handle((req) => require('../services/staffActivityService').listActivity(req.query));
