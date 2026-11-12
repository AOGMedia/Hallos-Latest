const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('../models/User');
const {
  ALL_PERMISSIONS,
  EMAIL_MARKETER_PERMISSIONS,
} = require('../config/staffPermissions');

const NO_ACCESS = Object.freeze({
  hasAccess: false,
  isSuperAdmin: false,
  roleName: null,
  permissions: [],
});

const LEGACY_EMAIL_MARKETER = Object.freeze({
  hasAccess: true,
  isSuperAdmin: false,
  roleName: 'Email marketer',
  permissions: EMAIL_MARKETER_PERMISSIONS,
});

const findAssignedRole = async (userId) => {
  const rows = await sequelize.query(
    `SELECT r.name, r.permissions
       FROM staff_assignments a
       JOIN staff_roles r ON r.id = a.role_id
      WHERE a.user_id = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return rows[0] || null;
};

/**
 * What a user may do, read fresh from the database on every call so that
 * removing someone's access applies to their very next request.
 */
async function resolveAccess(user) {
  if (!user) return NO_ACCESS;

  if (user.role === 'admin') {
    return {
      hasAccess: true,
      isSuperAdmin: true,
      roleName: 'Super admin',
      permissions: ALL_PERMISSIONS,
    };
  }

  // A missing table or failed lookup must not take away access a role already gives.
  let assigned = null;
  try {
    assigned = await findAssignedRole(user.id);
  } catch (error) {
    console.error('[StaffAccess] Role lookup failed:', error.message);
  }

  if (assigned) {
    return {
      hasAccess: true,
      isSuperAdmin: false,
      roleName: assigned.name,
      permissions: Array.isArray(assigned.permissions) ? assigned.permissions : [],
    };
  }

  return user.role === 'email_marketer' ? LEGACY_EMAIL_MARKETER : NO_ACCESS;
}

async function getStaffAccess(userId) {
  const user = await User.findByPk(userId, { attributes: ['id', 'role'] });
  return resolveAccess(user);
}

module.exports = { getStaffAccess, resolveAccess };
