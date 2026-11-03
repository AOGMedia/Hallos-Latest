const mailTransport = require('./mailTransport');

const settings = () => ({
  fromAddress: process.env.CAMPAIGN_EMAIL_FROM || process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
  fromName: process.env.EMAIL_CAMPAIGN_FROM_NAME || 'Hallos',
  replyTo: process.env.CAMPAIGN_EMAIL_REPLY_TO || process.env.EMAIL_REPLY_TO || process.env.EMAIL_USER
});

const sendCampaignMail = async ({ to, subject, html, text, unsubscribeUrl, recipientId }) => {
  const s = settings();
  const headers = {};
  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>, <mailto:${s.replyTo}?subject=unsubscribe>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  if (recipientId) headers['X-Entity-Ref-ID'] = recipientId;

  const info = await mailTransport.sendMail({
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

const verifyTransport = () => mailTransport.verify();

const describeTransport = () => ({ ...mailTransport.describe(), from: settings().fromAddress });

module.exports = { sendCampaignMail, verifyTransport, describeTransport };
