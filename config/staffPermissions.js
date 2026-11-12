/**
 * Everything a staff role can be granted. Super admins (users.role === 'admin')
 * are never checked against this list: they can do everything.
 *
 * Deliberately NOT grantable, so a staff role can never escalate itself:
 * changing a user's platform role, managing staff or roles, and the routes that
 * stay admin-only because no rule below opens them.
 */
const PERMISSION_GROUPS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    permissions: [{ code: 'dashboard.view', label: 'See platform stats and revenue' }],
  },
  {
    key: 'users',
    label: 'Users',
    permissions: [
      { code: 'users.view', label: 'See users and their details' },
      { code: 'users.email', label: 'Send a user a personal email', risky: true },
      { code: 'users.wallet', label: 'Credit or debit a user’s wallet', risky: true },
    ],
  },
  {
    key: 'live',
    label: 'Live classes',
    permissions: [
      { code: 'live.view', label: 'See live classes, series and who’s live now' },
      { code: 'live.manage', label: 'Force-stop a live class or session', risky: true },
    ],
  },
  {
    key: 'enrollments',
    label: 'Enrollments',
    permissions: [
      { code: 'enrollments.view', label: 'See enrollments' },
      { code: 'enrollments.manage', label: 'Mark credentials as sent' },
    ],
  },
  {
    key: 'communities',
    label: 'Communities',
    permissions: [
      { code: 'communities.view', label: 'See communities and members' },
      { code: 'communities.manage', label: 'Approve, suspend and moderate' },
    ],
  },
  {
    key: 'agency',
    label: 'Agency',
    permissions: [
      { code: 'agency.view', label: 'See agency applications' },
      { code: 'agency.manage', label: 'Review applications' },
    ],
  },
  {
    key: 'payouts',
    label: 'Payouts',
    permissions: [
      { code: 'payouts.view', label: 'See payout requests' },
      { code: 'payouts.approve', label: 'Approve or reject payouts', risky: true },
    ],
  },
  {
    key: 'transactions',
    label: 'Transactions',
    permissions: [{ code: 'transactions.view', label: 'Search and export transactions' }],
  },
  {
    key: 'coupons',
    label: 'Coupons',
    permissions: [
      { code: 'coupons.view', label: 'See coupons and analytics' },
      { code: 'coupons.manage', label: 'Create, edit and delete coupons' },
    ],
  },
  {
    key: 'referrals',
    label: 'Referrals and partners',
    permissions: [
      { code: 'referrals.view', label: 'See codes and commissions' },
      { code: 'referrals.manage', label: 'Create and edit codes' },
    ],
  },
  {
    key: 'quiz',
    label: 'Quiz',
    permissions: [
      { code: 'quiz.view', label: 'See questions and tournaments' },
      { code: 'quiz.manage', label: 'Manage questions and tournaments' },
      { code: 'quiz.balances', label: 'Adjust player balances', risky: true },
    ],
  },
  {
    key: 'blog',
    label: 'Blog',
    permissions: [
      { code: 'blog.view', label: 'See all posts' },
      { code: 'blog.manage', label: 'Write, publish and delete posts' },
    ],
  },
  {
    key: 'recordings',
    label: 'Recordings',
    permissions: [
      { code: 'recordings.view', label: 'See send history' },
      { code: 'recordings.send', label: 'Send recordings to students', risky: true },
    ],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    permissions: [
      { code: 'notifications.view', label: 'See delivery logs and digests' },
      { code: 'notifications.manage', label: 'Trigger digests' },
    ],
  },
  {
    key: 'feedback',
    label: 'Feedback',
    permissions: [
      { code: 'feedback.view', label: 'Read feedback' },
      { code: 'feedback.manage', label: 'Update and delete feedback' },
    ],
  },
  {
    key: 'email',
    label: 'Email campaigns',
    permissions: [
      { code: 'email.view', label: 'See campaigns and audiences' },
      { code: 'email.manage', label: 'Write and edit campaigns' },
      { code: 'email.send', label: 'Send and cancel campaigns', risky: true },
    ],
  },
  {
    key: 'security',
    label: 'Security',
    permissions: [
      { code: 'security.view', label: 'See fraud signals and limits' },
      { code: 'security.manage', label: 'Unblock users and set tiers', risky: true },
    ],
  },
  {
    key: 'audit',
    label: 'Audit log',
    permissions: [{ code: 'audit.view', label: 'Read the audit log' }],
  },
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.code)
);

const EMAIL_MARKETER_ROLE_NAME = 'Email marketer';
const EMAIL_MARKETER_PERMISSIONS = ['email.view', 'email.manage', 'email.send'];

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  EMAIL_MARKETER_ROLE_NAME,
  EMAIL_MARKETER_PERMISSIONS,
};
