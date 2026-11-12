/**
 * Email-verified sign-up. Signing up is two steps:
 *   1. start  — details are checked and held as a pending sign-up, and a
 *               6-digit code is emailed;
 *   2. verify — the right code creates the account (exactly as sign-up did
 *               before) and the pending sign-up is removed.
 * So no account exists for an address that can't receive mail.
 *
 * Codes are stored only as an HMAC and live in the database, so they survive
 * restarts and work across server instances.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op, fn, col, where, UniqueConstraintError } = require('sequelize');
const User = require('../models/User');
const PendingSignup = require('../models/PendingSignup');
const { isDisposableEmail, domainAcceptsMail } = require('../utils/emailDomainCheck');

const CODE_TTL_MINUTES = 15;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

class SignupError extends Error {
  constructor(message, status, code, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    // Extra fields for the response (attemptsRemaining, resendAfterSeconds).
    this.details = details;
    Object.assign(this, details);
  }
}

const emailKeyOf = (email) => String(email || '').trim().toLowerCase();

const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const hashCode = (emailKey, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET_KEY).update(`signup:${emailKey}:${code}`).digest('hex');

const codesMatch = (expectedHash, emailKey, code) => {
  const actual = Buffer.from(hashCode(emailKey, code), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

/** Case-insensitive, so "Ada@x.com" can't sign up again as "ada@x.com". */
const accountExists = async (emailKey) =>
  Boolean(await User.findOne({ where: where(fn('lower', col('email')), emailKey), attributes: ['id'] }));

const secondsUntilResend = (pending) =>
  Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - (Date.now() - new Date(pending.lastSentAt).getTime()) / 1000));

/** Drop sign-ups nobody finished. Best-effort, never blocks a request. */
const removeExpiredLater = () => {
  PendingSignup.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } }).catch((error) =>
    console.warn('[Signup] Could not remove expired pending sign-ups:', error.message)
  );
};

const sendCode = async (pending, code) => {
  // Loaded here so tests (and boot) don't need mail configuration.
  const { sendSignupVerificationCode } = require('../utils/email');
  try {
    await sendSignupVerificationCode(pending.email, pending.firstname, code, CODE_TTL_MINUTES);
  } catch (error) {
    console.error('[Signup] Verification email failed:', error.message);
    // Let them try again straight away rather than wait out the cooldown.
    await pending.update({ lastSentAt: new Date(0) }).catch(() => {});
    throw new SignupError("We couldn't send your code right now. Please try again.", 502, 'EMAIL_SEND_FAILED');
  }
};

/** A fresh code for this pending sign-up, respecting the cooldown and hourly cap. */
const issueCode = async (pending, fields = {}) => {
  const lastSent = new Date(pending.lastSentAt).getTime();
  const withinHour = Date.now() - lastSent < 60 * 60 * 1000;
  const sendCount = withinHour ? pending.sendCount : 0;
  if (sendCount >= MAX_SENDS_PER_HOUR) {
    throw new SignupError('Too many codes requested for this email. Please try again in an hour.', 429, 'TOO_MANY_CODES');
  }
  const code = generateCode();
  await pending.update({
    ...fields,
    codeHash: hashCode(pending.emailKey, code),
    codeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    attempts: 0,
    sendCount: sendCount + 1,
    lastSentAt: new Date(),
    expiresAt: new Date(Date.now() + PENDING_TTL_MS)
  });
  await sendCode(pending, code);
};

const startResult = (pending, resendAfterSeconds = RESEND_COOLDOWN_SECONDS) => ({
  email: pending.email,
  expiresInMinutes: CODE_TTL_MINUTES,
  resendAfterSeconds
});

/**
 * Step 1: check the details, hold them, email a code.
 * @returns {Promise<{ email: string, expiresInMinutes: number, resendAfterSeconds: number }>}
 */
const startSignup = async ({ firstname, lastname, email, password, referralCode, quizInviteToken }) => {
  const typedEmail = String(email).trim();
  const emailKey = emailKeyOf(email);

  if (await accountExists(emailKey)) {
    throw new SignupError('User already exists', 400, 'EMAIL_IN_USE');
  }
  if (isDisposableEmail(emailKey)) {
    throw new SignupError(
      "Temporary email addresses can't be used. Please use an email you'll keep.",
      400,
      'DISPOSABLE_EMAIL'
    );
  }
  if (!(await domainAcceptsMail(emailKey))) {
    throw new SignupError("This email address can't receive mail. Please check it for typos.", 400, 'EMAIL_DOMAIN_INVALID');
  }

  removeExpiredLater();

  const details = {
    email: typedEmail,
    firstname: String(firstname).trim(),
    lastname: String(lastname).trim(),
    passwordHash: await bcrypt.hash(password, 10),
    referralCode: referralCode ? String(referralCode).slice(0, 100) : null,
    quizInviteToken: quizInviteToken ? String(quizInviteToken).slice(0, 255) : null
  };

  let pending = await PendingSignup.findOne({ where: { emailKey } });
  if (pending && new Date(pending.expiresAt).getTime() < Date.now()) {
    await pending.destroy();
    pending = null;
  }

  if (pending) {
    // Signing up again with the same email: keep the latest details. A code
    // sent moments ago is still on its way, so don't send another yet.
    const wait = secondsUntilResend(pending);
    if (wait > 0) {
      await pending.update(details);
      return startResult(pending, wait);
    }
    await issueCode(pending, details);
    return startResult(pending);
  }

  const code = generateCode();
  try {
    pending = await PendingSignup.create({
      ...details,
      emailKey,
      codeHash: hashCode(emailKey, code),
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      attempts: 0,
      sendCount: 1,
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS)
    });
  } catch (error) {
    // Two taps at once: the other request created it and sent the code.
    if (error instanceof UniqueConstraintError) {
      const existing = await PendingSignup.findOne({ where: { emailKey } });
      if (existing) return startResult(existing, secondsUntilResend(existing));
    }
    throw error;
  }
  await sendCode(pending, code);
  return startResult(pending);
};

const findPending = async (email) => {
  const pending = await PendingSignup.findOne({ where: { emailKey: emailKeyOf(email) } });
  if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
    throw new SignupError('This sign-up has expired. Please sign up again.', 410, 'SIGNUP_EXPIRED');
  }
  return pending;
};

/** Send a new code for a pending sign-up. */
const resendCode = async ({ email }) => {
  const pending = await findPending(email);
  const wait = secondsUntilResend(pending);
  if (wait > 0) {
    throw new SignupError(`Please wait ${wait} seconds before requesting a new code.`, 429, 'RESEND_TOO_SOON', {
      resendAfterSeconds: wait
    });
  }
  await issueCode(pending);
  return startResult(pending);
};

/**
 * Step 2: the right code creates the account.
 * @returns {Promise<{ user: object, referralCode: string|null, quizInviteToken: string|null }>}
 */
const verifySignup = async ({ email, code }) => {
  const pending = await findPending(email);
  const digits = String(code || '').replace(/\D/g, '');

  if (pending.attempts >= MAX_ATTEMPTS) {
    throw new SignupError('Too many wrong codes. Please request a new code.', 429, 'TOO_MANY_ATTEMPTS');
  }
  if (new Date(pending.codeExpiresAt).getTime() < Date.now()) {
    throw new SignupError('This code has expired. Please request a new one.', 400, 'CODE_EXPIRED');
  }
  if (digits.length !== 6 || !codesMatch(pending.codeHash, pending.emailKey, digits)) {
    // Counted before the update (the in-memory value isn't refreshed by increment).
    const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - (pending.attempts + 1));
    await pending.increment('attempts');
    throw new SignupError(
      attemptsRemaining > 0 ? "That code isn't right. Please check it and try again." : 'Too many wrong codes. Please request a new code.',
      400,
      'INVALID_CODE',
      { attemptsRemaining }
    );
  }

  // The email may have been used meanwhile (e.g. Google sign-in).
  if (await accountExists(pending.emailKey)) {
    await pending.destroy();
    throw new SignupError('This email already has an account. Please log in.', 409, 'EMAIL_IN_USE');
  }

  let user;
  try {
    // Same account as sign-up has always created.
    user = await User.create({
      firstname: pending.firstname,
      lastname: pending.lastname,
      email: pending.email,
      password: pending.passwordHash
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new SignupError('This email already has an account. Please log in.', 409, 'EMAIL_IN_USE');
    }
    throw error;
  }

  const { referralCode, quizInviteToken } = pending;
  await pending.destroy().catch((error) => console.warn('[Signup] Could not remove pending sign-up:', error.message));
  return { user, referralCode, quizInviteToken };
};

module.exports = {
  startSignup,
  resendCode,
  verifySignup,
  SignupError,
  // Exported for tests.
  hashCode,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS
};
