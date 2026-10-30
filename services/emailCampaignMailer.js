const nodemailer = require('nodemailer');

/**
 * Campaigns use CAMPAIGN_EMAIL_* when set (so bulk mail can run through a
 * dedicated provider and never compete with OTP / receipt emails for the
 * support mailbox quota), otherwise they fall back to the EMAIL_* mailbox.
 */
const settings = () => {
  const custom = Boolean(process.env.CAMPAIGN_EMAIL_HOST);
  const prefix = custom ? 'CAMPAIGN_EMAIL_' : 'EMAIL_';
  return {
    custom,
    host: process.env[`${prefix}HOST`],
    port: parseInt(process.env[`${prefix}PORT`], 10) || 465,
    secure: String(process.env[`${prefix}SECURE`]) === 'true',
    user: process.env[`${prefix}USER`],
    pass: process.env[`${prefix}PASS`],
    fromAddress: process.env.CAMPAIGN_EMAIL_FROM || process.env[`${prefix}USER`],
    fromName: process.env.EMAIL_CAMPAIGN_FROM_NAME || 'Hallos',
    replyTo: process.env.CAMPAIGN_EMAIL_REPLY_TO || process.env.EMAIL_USER
  };
};

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  const s = settings();
  transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass: s.pass },
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    tls: { rejectUnauthorized: false }
  });
  return transporter;
};

const sendCampaignMail = async ({ to, subject, html, text, unsubscribeUrl, recipientId }) => {
  const s = settings();
  const headers = {};
  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>, <mailto:${s.replyTo}?subject=unsubscribe>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  if (recipientId) headers['X-Entity-Ref-ID'] = recipientId;

  const info = await getTransporter().sendMail({
    from: `"${s.fromName}" <${s.fromAddress}>`,
    replyTo: s.replyTo,
    to,
    subject,
    html,
    text,
    headers
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
};

const verifyTransport = () => getTransporter().verify();

const describeTransport = () => {
  const s = settings();
  return { host: s.host, from: s.fromAddress, dedicatedProvider: s.custom };
};

module.exports = { sendCampaignMail, verifyTransport, describeTransport };
