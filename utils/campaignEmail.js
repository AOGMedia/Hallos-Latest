const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');

const STYLE_VALUE = [/^[#(),.%\w\s-]+$/];

const SANITIZE_OPTIONS = {
  allowedTags: [
    'a', 'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4',
    'ul', 'ol', 'li', 'blockquote', 'span', 'div', 'img', 'table', 'thead', 'tbody',
    'tr', 'td', 'th', 'center', 'small', 'sup', 'sub', 'pre', 'code'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'style'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    td: ['colspan', 'rowspan', 'align', 'valign', 'style'],
    th: ['colspan', 'rowspan', 'align', 'valign', 'style'],
    table: ['width', 'cellpadding', 'cellspacing', 'border', 'align', 'style'],
    '*': ['style', 'align']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowedStyles: {
    '*': {
      color: STYLE_VALUE,
      'background-color': STYLE_VALUE,
      'text-align': STYLE_VALUE,
      'font-size': STYLE_VALUE,
      'font-weight': STYLE_VALUE,
      'font-style': STYLE_VALUE,
      'text-decoration': STYLE_VALUE,
      'line-height': STYLE_VALUE,
      padding: STYLE_VALUE,
      margin: STYLE_VALUE,
      'border-radius': STYLE_VALUE,
      width: STYLE_VALUE,
      'max-width': STYLE_VALUE,
      display: STYLE_VALUE
    }
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
  }
};

const sanitizeCampaignHtml = (html) => sanitizeHtml(String(html || ''), SANITIZE_OPTIONS);

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const MERGE_TAG = /\{\{\s*(\w+)(?:\s*\|\s*([^}]*?))?\s*\}\}/g;

const buildMergeVars = (recipient, unsubscribeUrl) => {
  const firstName = (recipient.firstName || '').trim();
  const lastName = (recipient.lastName || '').trim();
  return {
    firstname: firstName,
    lastname: lastName,
    fullname: `${firstName} ${lastName}`.trim(),
    email: recipient.email || '',
    unsubscribeurl: unsubscribeUrl || ''
  };
};

/**
 * Replaces {{firstName}}, {{lastName}}, {{fullName}}, {{email}} and
 * {{unsubscribeUrl}}. {{firstName|there}} supplies a fallback when the value
 * is empty. Unknown tags are left untouched. Pass escape=true for HTML bodies.
 */
const applyMergeTags = (template, vars, { escape = true } = {}) =>
  String(template || '').replace(MERGE_TAG, (match, key, fallback) => {
    const value = vars[key.toLowerCase()];
    if (value === undefined) return match;
    const resolved = value || (fallback !== undefined ? fallback.trim() : '');
    return escape ? escapeHtml(resolved) : resolved;
  });

const htmlToText = (html) =>
  String(html || '')
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<\/(p|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<(br|\/div|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const unsubscribeSecret = () => `${process.env.JWT_SECRET_KEY || 'hallos'}:email-unsubscribe`;

const signEmail = (email) =>
  crypto.createHmac('sha256', unsubscribeSecret()).update(String(email).trim().toLowerCase()).digest('base64url');

const verifyEmailToken = (email, token) => {
  if (!email || !token) return false;
  const expected = Buffer.from(signEmail(email));
  const given = Buffer.from(String(token));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

const getPublicApiBase = () =>
  (process.env.EMAIL_UNSUBSCRIBE_BASE_URL || process.env.API_PUBLIC_URL || 'https://hallos-latest.onrender.com')
    .replace(/\/+$/, '');

const buildUnsubscribeUrl = (email) => {
  const e = Buffer.from(String(email).trim().toLowerCase()).toString('base64url');
  return `${getPublicApiBase()}/api/email-portal/unsubscribe?e=${e}&t=${signEmail(email)}`;
};

const decodeEmailParam = (encoded) => {
  try {
    return Buffer.from(String(encoded), 'base64url').toString('utf8').trim().toLowerCase();
  } catch {
    return '';
  }
};

const SOCIAL_LINKS = [
  ['LinkedIn', 'https://www.linkedin.com/company/106357438/'],
  ['Instagram', 'https://www.instagram.com/learning247live/'],
  ['X', 'https://x.com/Learning247Live'],
  ['TikTok', 'https://www.tiktok.com/@learning247live?lang=en'],
  ['WhatsApp', 'https://whatsapp.com/channel/0029VbAuQCzGpLHXVDV17t3u']
];

const renderShell = ({ bodyHtml, preheader, unsubscribeUrl }) => {
  const socials = SOCIAL_LINKS
    .map(([label, href]) => `<a href="${href}" style="color:#6c5ce7;text-decoration:none;margin:0 6px;">${label}</a>`)
    .join('&middot;');

  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;">
${hidden}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;">
      <tr><td style="padding:24px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#6c5ce7;">Hallos</td></tr>
      <tr><td style="padding:8px 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#222222;">
${bodyHtml}
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#888888;text-align:center;">
        <div style="margin-bottom:10px;">${socials}</div>
        You are receiving this email because you have an account on Hallos.<br>
        <a href="${unsubscribeUrl}" style="color:#888888;">Unsubscribe</a> from these emails.<br>
        &copy; ${new Date().getFullYear()} Hallos. All rights reserved.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
};

/**
 * Builds the full message for one recipient. Subject and body get merge tags
 * applied per recipient; the stored body is already sanitised at save time.
 */
const renderCampaignEmail = ({ subject, preheader, bodyHtml }, recipient) => {
  const unsubscribeUrl = buildUnsubscribeUrl(recipient.email);
  const vars = buildMergeVars(recipient, unsubscribeUrl);

  const renderedSubject = applyMergeTags(subject, vars, { escape: false }).replace(/[\r\n]+/g, ' ').trim();
  const renderedBody = applyMergeTags(bodyHtml, vars, { escape: true });
  const html = renderShell({
    bodyHtml: renderedBody,
    preheader: preheader ? applyMergeTags(preheader, vars, { escape: false }) : '',
    unsubscribeUrl
  });
  const text = `${htmlToText(renderedBody)}\n\n--\nUnsubscribe: ${unsubscribeUrl}`;

  return { subject: renderedSubject, html, text, unsubscribeUrl };
};

module.exports = {
  sanitizeCampaignHtml,
  escapeHtml,
  applyMergeTags,
  buildMergeVars,
  htmlToText,
  signEmail,
  verifyEmailToken,
  buildUnsubscribeUrl,
  decodeEmailParam,
  renderCampaignEmail
};
