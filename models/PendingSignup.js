const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * A sign-up waiting for its email to be verified. The account (users row) is
 * only created once the emailed code is confirmed, so an address that can't
 * receive mail never becomes an account. Rows are removed on success and
 * expire after a day.
 *
 * New table — created by sequelize.sync on boot (and by the matching
 * migration); the users table is not changed.
 */
const PendingSignup = sequelize.define('PendingSignup', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  /** Lower-cased email: one pending sign-up per address. */
  emailKey: { type: DataTypes.STRING, allowNull: false, field: 'email_key' },
  /** The email as typed — the account is created with it, as before. */
  email: { type: DataTypes.STRING, allowNull: false },
  firstname: { type: DataTypes.STRING, allowNull: false },
  lastname: { type: DataTypes.STRING, allowNull: false },
  passwordHash: { type: DataTypes.STRING, allowNull: false, field: 'password_hash' },
  /** HMAC of the current code — the code itself is never stored. */
  codeHash: { type: DataTypes.STRING(128), allowNull: false, field: 'code_hash' },
  codeExpiresAt: { type: DataTypes.DATE, allowNull: false, field: 'code_expires_at' },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  sendCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'send_count' },
  lastSentAt: { type: DataTypes.DATE, allowNull: false, field: 'last_sent_at' },
  expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
  /** Carried through to account creation (referral link, quiz invite). */
  referralCode: { type: DataTypes.STRING(100), allowNull: true, field: 'referral_code' },
  quizInviteToken: { type: DataTypes.STRING(255), allowNull: true, field: 'quiz_invite_token' }
}, {
  tableName: 'pending_signups',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['email_key'], name: 'pending_signups_email_key_unique' },
    { fields: ['expires_at'], name: 'pending_signups_expires_idx' }
  ]
});

module.exports = PendingSignup;
