const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { col, fn, where, QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('../models/User');
const mailTransport = require('./mailTransport');
const { ALL_PERMISSIONS } = require('../config/staffPermissions');
const { isStaffAccessReady } = require('../utils/ensureStaffAccess');

const INVITE_LIFETIME = '7d';
const INVITE_PURPOSE = 'staff_invite';
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

class StaffError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const assertReady = () => {
  if (!isStaffAccessReady()) {
    throw new StaffError(503, 'Staff roles are unavailable right now. Check the server logs.');
  }
};

const select = (sql, replacements = {}) =>
  sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const run = (sql, replacements = {}) => sequelize.query(sql, { replacements });

const toRole = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  permissions: Array.isArray(row.permissions) ? row.permissions : [],
  isSystem: row.is_system,
  memberCount: Number(row.member_count || 0),
  createdAt: row.created_at,
});

const appUrl = () => String(process.env.ADMIN_APP_URL || '').trim().replace(/\/+$/, '');

function validateRoleInput({ name, description, permissions }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new StaffError(400, 'A role name needs 2 to 80 characters.');
  }
  if (cleanName.toLowerCase() === 'super admin') {
    throw new StaffError(400, 'That name is reserved.');
  }
  if (!Array.isArray(permissions)) {
    throw new StaffError(400, 'Choose at least one permission.');
  }
  const unique = [...new Set(permissions)];
  if (unique.length === 0) throw new StaffError(400, 'Choose at least one permission.');
  if (unique.some((code) => !ALL_PERMISSIONS.includes(code))) {
    throw new StaffError(400, 'One of those permissions does not exist.');
  }
  return {
    name: cleanName,
    description: description ? String(description).trim().slice(0, 500) : null,
    permissions: JSON.stringify(unique),
  };
}

const isUniqueViolation = (error) => error?.original?.code === '23505';

async function listRoles() {
  assertReady();
  const rows = await select(
    `SELECT r.*, COUNT(a.user_id) AS member_count
       FROM staff_roles r
       LEFT JOIN staff_assignments a ON a.role_id = r.id
      GROUP BY r.id
      ORDER BY r.is_system DESC, lower(r.name) ASC`
  );
  return rows.map(toRole);
}

async function getRole(id) {
  const rows = await select(
    `SELECT r.*, (SELECT COUNT(*) FROM staff_assignments a WHERE a.role_id = r.id) AS member_count
       FROM staff_roles r WHERE r.id = :id`,
    { id }
  ).catch(() => []);
  if (!rows[0]) throw new StaffError(404, 'That role no longer exists.');
  return toRole(rows[0]);
}

async function createRole(input, actorId) {
  assertReady();
  const role = validateRoleInput(input);
  try {
    const rows = await select(
      `INSERT INTO staff_roles (name, description, permissions, created_by)
       VALUES (:name, :description, CAST(:permissions AS jsonb), :actorId)
       RETURNING *`,
      { ...role, actorId }
    );
    return toRole(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new StaffError(409, 'A role with that name already exists.');
    throw error;
  }
}

async function updateRole(id, input) {
  assertReady();
  await getRole(id);
  const role = validateRoleInput(input);
  try {
    await run(
      `UPDATE staff_roles
          SET name = :name, description = :description,
              permissions = CAST(:permissions AS jsonb), updated_at = CURRENT_TIMESTAMP
        WHERE id = :id`,
      { ...role, id }
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new StaffError(409, 'A role with that name already exists.');
    throw error;
  }
  return getRole(id);
}

async function deleteRole(id) {
  assertReady();
  const role = await getRole(id);
  if (role.isSystem) throw new StaffError(400, 'This built-in role can be edited but not deleted.');
  if (role.memberCount > 0) {
    throw new StaffError(409, 'Move the staff in this role to another role first.');
  }
  await run('DELETE FROM staff_roles WHERE id = :id', { id });
}

const toPerson = (user) => ({
  id: user.id,
  firstname: user.firstname,
  lastname: user.lastname,
  email: user.email,
});

async function listStaff() {
  assertReady();
  const [superAdmins, assignments] = await Promise.all([
    User.findAll({
      where: { role: 'admin' },
      attributes: ['id', 'firstname', 'lastname', 'email'],
      order: [['firstname', 'ASC']],
    }),
    select(
      `SELECT a.user_id, a.invite_pending, a.created_at, r.id AS role_id, r.name AS role_name
         FROM staff_assignments a JOIN staff_roles r ON r.id = a.role_id`
    ),
  ]);

  const users = await User.findAll({
    where: { id: assignments.map((row) => row.user_id) },
    attributes: ['id', 'firstname', 'lastname', 'email'],
  });
  const usersById = new Map(users.map((user) => [user.id, user]));

  return {
    superAdmins: superAdmins.map(toPerson),
    members: assignments
      .filter((row) => usersById.has(row.user_id))
      .map((row) => ({
        ...toPerson(usersById.get(row.user_id)),
        roleId: row.role_id,
        roleName: row.role_name,
        invitePending: row.invite_pending,
        addedAt: row.created_at,
      }))
      .sort((a, b) => a.firstname.localeCompare(b.firstname)),
  };
}

// Signed with the account's current password hash, so a link stops working the
// moment it is used, and it can never pass as a normal login token.
const inviteSecret = (user) =>
  `${process.env.JWT_SECRET_KEY}:${INVITE_PURPOSE}:${user.password}`;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function sendInvite(user, roleName) {
  const token = jwt.sign({ sub: String(user.id), purpose: INVITE_PURPOSE }, inviteSecret(user), {
    expiresIn: INVITE_LIFETIME,
  });
  const link = `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;
  const sender = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER;

  await mailTransport.sendMail({
    from: `"Hallos" <${sender}>`,
    to: user.email,
    subject: 'You’ve been added to the Hallos team',
    html: `<p>Hi ${escapeHtml(user.firstname)},</p>
<p>You now have access to the Hallos workspace as <strong>${escapeHtml(roleName)}</strong>.</p>
<p><a href="${link}">Set your password</a> to get started. This link works once and expires in 7 days.</p>`,
  });
}

async function trySendInvite(user, roleName) {
  try {
    await sendInvite(user, roleName);
    return true;
  } catch (error) {
    console.error('[StaffManagement] Invite email failed:', error.message);
    return false;
  }
}

const findUserByEmail = (email) =>
  User.findOne({ where: where(fn('lower', col('email')), email.toLowerCase()) });

const assign = (userId, roleId, actorId, invitePending) =>
  run(
    `INSERT INTO staff_assignments (user_id, role_id, assigned_by, invite_pending)
     VALUES (:userId, :roleId, :actorId, :invitePending)
     ON CONFLICT (user_id) DO UPDATE
       SET role_id = EXCLUDED.role_id, assigned_by = EXCLUDED.assigned_by,
           updated_at = CURRENT_TIMESTAMP`,
    { userId, roleId, actorId, invitePending }
  );

/** Gives an existing account a role, or creates one and emails a set-password link. */
async function addMember({ email, firstname, lastname, roleId }, actorId) {
  assertReady();
  const cleanEmail = String(email || '').trim();
  if (!EMAIL_RE.test(cleanEmail)) throw new StaffError(400, 'Enter a valid email address.');
  const role = await getRole(roleId);

  const existing = await findUserByEmail(cleanEmail);
  if (existing) {
    if (existing.role === 'admin') {
      throw new StaffError(400, 'That person is already a super admin.');
    }
    await assign(existing.id, role.id, actorId, false);
    return { created: false, inviteSent: false, member: toPerson(existing) };
  }

  const first = String(firstname || '').trim();
  const last = String(lastname || '').trim();
  if (!first || !last) {
    throw new StaffError(400, 'No account uses that email yet. Add their first and last name to create one.');
  }
  if (!appUrl()) {
    throw new StaffError(503, 'Set ADMIN_APP_URL on the server so invite links can be sent.');
  }

  const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const user = await User.create({
    firstname: first,
    lastname: last,
    email: cleanEmail.toLowerCase(),
    password,
  });
  await assign(user.id, role.id, actorId, true);
  const inviteSent = await trySendInvite(user, role.name);
  return { created: true, inviteSent, member: toPerson(user) };
}

async function getAssignment(userId) {
  if (!Number.isInteger(Number(userId))) {
    throw new StaffError(404, 'That staff member no longer exists.');
  }
  const rows = await select(
    `SELECT a.*, r.name AS role_name FROM staff_assignments a
       JOIN staff_roles r ON r.id = a.role_id
      WHERE a.user_id = :userId`,
    { userId }
  );
  if (!rows[0]) throw new StaffError(404, 'That staff member no longer exists.');
  return rows[0];
}

async function updateMemberRole(userId, roleId, actorId) {
  assertReady();
  await getAssignment(userId);
  const role = await getRole(roleId);
  await run(
    `UPDATE staff_assignments
        SET role_id = :roleId, assigned_by = :actorId, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = :userId`,
    { userId, roleId: role.id, actorId }
  );
}

/** Ends staff access. The person's normal Hallos account is left as it was. */
async function removeMember(userId) {
  assertReady();
  await getAssignment(userId);
  await sequelize.transaction(async (transaction) => {
    await sequelize.query('DELETE FROM staff_assignments WHERE user_id = :userId', {
      replacements: { userId },
      transaction,
    });
    // Otherwise this legacy role would grant the portal again.
    await User.update(
      { role: 'viewer' },
      { where: { id: userId, role: 'email_marketer' }, transaction }
    );
  });
}

async function resendInvite(userId) {
  assertReady();
  const assignment = await getAssignment(userId);
  if (!assignment.invite_pending) {
    throw new StaffError(400, 'This person has already set their password.');
  }
  if (!appUrl()) throw new StaffError(503, 'Set ADMIN_APP_URL on the server so invite links can be sent.');
  const user = await User.findByPk(userId);
  return { inviteSent: await trySendInvite(user, assignment.role_name) };
}

const INVALID_LINK = 'This link has expired or was already used. Ask for a new invite.';

async function setPasswordFromInvite(token, newPassword) {
  assertReady();
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new StaffError(400, `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const claims = jwt.decode(String(token || ''));
  if (!claims || claims.purpose !== INVITE_PURPOSE || !claims.sub) {
    throw new StaffError(400, INVALID_LINK);
  }
  const user = await User.findByPk(claims.sub);
  if (!user) throw new StaffError(400, INVALID_LINK);

  try {
    jwt.verify(String(token), inviteSecret(user), { algorithms: ['HS256'] });
  } catch {
    throw new StaffError(400, INVALID_LINK);
  }

  const assignment = await getAssignment(user.id).catch(() => null);
  if (!assignment || !assignment.invite_pending) throw new StaffError(400, INVALID_LINK);

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  await run('UPDATE staff_assignments SET invite_pending = false WHERE user_id = :userId', {
    userId: user.id,
  });
}

module.exports = {
  StaffError,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listStaff,
  addMember,
  updateMemberRole,
  removeMember,
  resendInvite,
  setPasswordFromInvite,
};
