/**
 * Quiz Invite Service
 *
 * Sends "join me on the quiz platform" invitations via:
 *   1. Email   — nodemailer (existing SMTP setup)
 *   2. WhatsApp — wa.me deep-link (no API key needed)
 *   3. SMS     — Twilio (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER)
 *
 * All three channels share the same invite link:
 *   {CLIENT_URL}/quiz?invite={inviterUserId}
 *
 * SMS falls back gracefully if Twilio env vars are not set.
 */

const { sendQuizInviteEmail } = require('../utils/email');

/**
 * Build the canonical invite URL for the quiz platform.
 * @param {number|string} inviterUserId
 * @returns {string}
 */
function buildInviteUrl(inviterUserId) {
  const base = (process.env.CLIENT_URL || 'https://hallos.net').replace(/\/$/, '');
  return `${base}/quiz?invite=${inviterUserId}`;
}

/**
 * Build a WhatsApp share URL (wa.me deep-link — no API needed).
 * The frontend can open this URL directly; no server-side send needed.
 *
 * @param {string} inviterName
 * @param {string} inviteUrl
 * @returns {string} WhatsApp deep-link URL
 */
function buildWhatsAppShareUrl(inviterName, inviteUrl) {
  const message =
    `🎮 *${inviterName}* is challenging you to a quiz on Hallos!\n\n` +
    `Test your knowledge, win Chuta coins, and have fun.\n\n` +
    `Join now 👉 ${inviteUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * Build a generic SMS share URL (sms: URI scheme).
 * Works on mobile browsers to pre-fill a text message.
 * Also used as the body when sending via Twilio.
 *
 * @param {string} inviterName
 * @param {string} inviteUrl
 * @returns {{ smsUri: string, smsBody: string }}
 */
function buildSmsContent(inviterName, inviteUrl) {
  const smsBody =
    `${inviterName} is challenging you to a quiz on Hallos! ` +
    `Win Chuta coins and have fun. Join now: ${inviteUrl}`;
  const smsUri = `sms:?body=${encodeURIComponent(smsBody)}`;
  return { smsUri, smsBody };
}

/**
 * Send a quiz invite email.
 *
 * @param {Object} params
 * @param {string} params.toEmail       - Recipient email address
 * @param {string} params.inviterName   - Display name of the person inviting
 * @param {number} params.inviterUserId - Used to build the invite URL
 * @returns {Promise<{ success: boolean, channel: 'email' }>}
 */
async function sendEmailInvite({ toEmail, inviterName, inviterUserId }) {
  if (!toEmail || !toEmail.includes('@')) {
    throw new Error('A valid email address is required');
  }

  const inviteUrl = buildInviteUrl(inviterUserId);
  await sendQuizInviteEmail(toEmail, inviterName, inviteUrl);
  return { success: true, channel: 'email', inviteUrl };
}

/**
 * Send a quiz invite via SMS using Twilio.
 *
 * @param {Object} params
 * @param {string} params.toPhone       - Recipient phone number (E.164 e.g. +2347012345678)
 * @param {string} params.inviterName   - Display name of the person inviting
 * @param {number} params.inviterUserId - Used to build the invite URL
 * @returns {Promise<{ success: boolean, channel: 'sms', sid?: string }>}
 */
async function sendSmsInvite({ toPhone, inviterName, inviterUserId }) {
  if (!toPhone) {
    throw new Error('A phone number is required');
  }

  // Normalise: ensure E.164 format
  const phone = toPhone.startsWith('+') ? toPhone : `+${toPhone}`;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    throw new Error(
      'SMS is not configured on this server. ' +
      'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in environment.'
    );
  }

  const twilio = require('twilio');
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  const inviteUrl = buildInviteUrl(inviterUserId);
  const { smsBody } = buildSmsContent(inviterName, inviteUrl);

  const message = await client.messages.create({
    body: smsBody,
    from: TWILIO_PHONE_NUMBER,
    to: phone
  });

  return { success: true, channel: 'sms', sid: message.sid, inviteUrl };
}

/**
 * Generate WhatsApp and SMS share links (no server-side send).
 * The frontend opens these URLs directly on the user's device.
 *
 * @param {Object} params
 * @param {string} params.inviterName
 * @param {number} params.inviterUserId
 * @returns {{ whatsappUrl: string, smsUri: string, inviteUrl: string }}
 */
function getShareLinks({ inviterName, inviterUserId }) {
  const inviteUrl = buildInviteUrl(inviterUserId);
  const whatsappUrl = buildWhatsAppShareUrl(inviterName, inviteUrl);
  const { smsUri } = buildSmsContent(inviterName, inviteUrl);
  return { whatsappUrl, smsUri, inviteUrl };
}

module.exports = {
  sendEmailInvite,
  sendSmsInvite,
  getShareLinks,
  buildInviteUrl,
  buildWhatsAppShareUrl,
  buildSmsContent
};
