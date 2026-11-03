const axios = require('axios');
const nodemailer = require('nodemailer');

const BREVO_API_URL = 'https://api.brevo.com/v3';
const REQUEST_TIMEOUT_MS = 20 * 1000;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const NETWORK_ERROR_CODES = ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];
const SMTP_CONNECTION_CODES = ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'EDNS'];

const brevoKey = () => String(process.env.BREVO_API_KEY || '').trim();

/**
 * Brevo's HTTPS API is used whenever BREVO_API_KEY is set (it works on hosts that block outbound SMTP,
 * such as Render). Otherwise mail goes out over the EMAIL_* SMTP mailbox. MAIL_PROVIDER=smtp|brevo forces one.
 */
const provider = () => {
  const forced = String(process.env.MAIL_PROVIDER || '').toLowerCase();
  if (forced === 'smtp') return 'smtp';
  if (forced === 'brevo' || brevoKey()) return 'brevo';
  return 'smtp';
};

const mailError = (message, code, extra = {}) => Object.assign(new Error(message), { code }, extra);

const parseOne = (value) => {
  if (!value) return null;
  if (typeof value === 'object') {
    const email = String(value.address || value.email || '').trim();
    return email ? { email, name: value.name || undefined } : null;
  }
  const text = String(value).trim();
  const match = text.match(/^(.*)<([^<>]+)>\s*$/);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return { email: match[2].trim(), name: name || undefined };
  }
  return { email: text };
};

const parseList = (value) => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const parsed = parseOne(item);
    if (!parsed || !EMAIL_RE.test(parsed.email)) continue;
    const key = parsed.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
};

/**
 * Existing callers build `from` with EMAIL_USER (the old SMTP mailbox). When EMAIL_FROM_ADDRESS is set,
 * that legacy address is swapped for it; any other explicit address is respected as given.
 */
const resolveSender = (from) => {
  const parsed = parseOne(from) || {};
  const legacy = String(process.env.EMAIL_USER || '').toLowerCase();
  const configured = process.env.EMAIL_FROM_ADDRESS;
  let email = parsed.email;
  if (configured && (!email || email.toLowerCase() === legacy)) email = configured;
  email = email || process.env.EMAIL_USER;
  return { email, name: parsed.name || process.env.EMAIL_FROM_NAME || 'Hallos' };
};

const pascalHeader = (name) =>
  String(name)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-');

const toBrevoError = (error) => {
  if (!error.response) {
    return mailError(`Could not reach the Brevo API (${error.code || error.message}).`, 'ECONNECTION');
  }
  const status = error.response.status;
  const data = error.response.data || {};
  const detail = String(data.message || data.error_description || error.message || '').slice(0, 300);
  const extra = { responseCode: status, response: detail, brevoCode: data.code };

  if (status === 401 || status === 403) {
    return mailError(
      `Brevo rejected the API key or this server's IP (${status}): ${detail}. Check BREVO_API_KEY, and Security > Authorised IPs in Brevo.`,
      'EAUTH',
      extra
    );
  }
  if (status === 429) return mailError(`Brevo rate limit reached (429): ${detail}`, 'ERATE', extra);
  if (status >= 500) return mailError(`Brevo is temporarily unavailable (${status}).`, 'EPROVIDER', extra);
  if (/sender/i.test(detail)) {
    return mailError(`Brevo rejected the sender address: ${detail}`, 'EAUTH', extra);
  }
  return mailError(`Brevo refused the email (${status}): ${detail}`, 'EMESSAGE', extra);
};

const sendViaBrevo = async (mail) => {
  const key = brevoKey();
  if (!key) throw mailError('BREVO_API_KEY is not set.', 'EAUTH');

  const sender = resolveSender(mail.from);
  if (!sender.email) throw mailError('No sender address configured. Set EMAIL_FROM_ADDRESS.', 'EAUTH');

  const to = parseList(mail.to);
  if (!to.length) throw mailError('No valid recipient address.', 'EENVELOPE');
  if (!mail.html && !mail.text) throw mailError('Email has no body.', 'EMESSAGE');

  const payload = { sender, to, subject: mail.subject || '' };
  if (mail.html) payload.htmlContent = mail.html;
  if (mail.text) payload.textContent = mail.text;

  const cc = parseList(mail.cc);
  const bcc = parseList(mail.bcc);
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;

  const replyTo = parseOne(mail.replyTo) || parseOne(process.env.EMAIL_REPLY_TO);
  if (replyTo && EMAIL_RE.test(replyTo.email)) payload.replyTo = replyTo;

  if (mail.headers && Object.keys(mail.headers).length) {
    payload.headers = Object.fromEntries(Object.entries(mail.headers).map(([k, v]) => [pascalHeader(k), String(v)]));
  }

  if (Array.isArray(mail.attachments) && mail.attachments.length) {
    payload.attachment = mail.attachments.map((file) => ({
      name: file.filename,
      content: Buffer.isBuffer(file.content) ? file.content.toString('base64') : Buffer.from(String(file.content)).toString('base64')
    }));
  }

  try {
    const response = await axios.post(`${BREVO_API_URL}/smtp/email`, payload, {
      headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' },
      timeout: REQUEST_TIMEOUT_MS
    });
    const messageId = response.data?.messageId || (response.data?.messageIds || [])[0];
    return { messageId, accepted: [...to, ...cc, ...bcc].map((r) => r.email), rejected: [], response: `Brevo ${response.status}` };
  } catch (error) {
    throw toBrevoError(error);
  }
};

let smtpTransporter = null;

const getSmtpTransporter = () => {
  if (smtpTransporter) return smtpTransporter;
  smtpTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 465,
    secure: String(process.env.EMAIL_SECURE) === 'true',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    connectionTimeout: 20 * 1000,
    greetingTimeout: 20 * 1000,
    socketTimeout: 60 * 1000,
    tls: { rejectUnauthorized: false }
  });
  return smtpTransporter;
};

const sendViaSmtp = async (mail) => {
  try {
    return await getSmtpTransporter().sendMail(mail);
  } catch (error) {
    if (SMTP_CONNECTION_CODES.includes(error.code)) {
      error.message = `Could not connect to the mail server (${error.code}). Render free instances block outbound SMTP (ports 25, 465, 587); set BREVO_API_KEY to send over HTTPS instead.`;
    }
    throw error;
  }
};

/** Nodemailer-compatible: accepts { from, to, cc, bcc, replyTo, subject, html, text, headers, attachments }. */
const sendMail = (mail) => (provider() === 'brevo' ? sendViaBrevo(mail) : sendViaSmtp(mail));

const verify = async () => {
  if (provider() === 'smtp') {
    await getSmtpTransporter().verify();
    return { provider: 'smtp', host: process.env.EMAIL_HOST };
  }
  const key = brevoKey();
  if (!key) throw mailError('BREVO_API_KEY is not set.', 'EAUTH');
  try {
    const response = await axios.get(`${BREVO_API_URL}/account`, {
      headers: { 'api-key': key, accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS
    });
    return { provider: 'brevo', accountEmail: response.data?.email, plan: response.data?.plan };
  } catch (error) {
    throw toBrevoError(error);
  }
};

const describe = () => {
  const active = provider();
  return {
    provider: active,
    host: active === 'brevo' ? 'api.brevo.com' : process.env.EMAIL_HOST,
    from: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
    dedicatedProvider: active === 'brevo'
  };
};

module.exports = { sendMail, verify, describe, provider, parseList, resolveSender };
