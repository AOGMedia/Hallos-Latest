const dns = require('dns').promises;

/**
 * Sign-up checks that an email address is one a real person can receive mail
 * at: not a throwaway (disposable) service, and on a domain that accepts mail.
 *
 * The mail check fails open: if DNS can't be reached or is slow, the address
 * is allowed — a network hiccup must never block a real person. The emailed
 * code is the real proof anyway; this only stops obvious junk early.
 */

// Common throwaway inbox services. Add more here as they turn up.
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com',
  'anonbox.net', 'burnermail.io', 'byom.de', 'deadaddress.com', 'discard.email',
  'discardmail.com', 'dispostable.com', 'dropmail.me', 'email-fake.com', 'emailfake.com',
  'emailondeck.com', 'emailtemporanea.com', 'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com',
  'getairmail.com', 'getnada.com', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com',
  'inboxbear.com', 'inboxkitten.com', 'incognitomail.org', 'jetable.org', 'mail-temp.com',
  'mail.tm', 'mailcatch.com', 'maildrop.cc', 'mailinator.com', 'mailinator.net',
  'mailinator2.com', 'mailnesia.com', 'mailpoof.com', 'mailsac.com', 'mintemail.com',
  'moakt.com', 'mohmal.com', 'mytemp.email', 'nada.email', 'nowmymail.com',
  'one-time.email', 'sharklasers.com', 'spam4.me', 'spambog.com', 'spambox.us',
  'spamgourmet.com', 'tempail.com', 'tempinbox.com', 'tempmail.com', 'tempmail.dev',
  'tempmail.net', 'tempmail.plus', 'tempmailo.com', 'tempr.email', 'temp-mail.io',
  'temp-mail.org', 'throwawaymail.com', 'tmail.ws', 'tmailor.com', 'tmpmail.net',
  'tmpmail.org', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'wegwerfmail.de',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'zetmail.com', 'emailnax.com',
  'mailto.plus', 'fexpost.com', 'fexbox.org', 'rover.info', 'chitthi.in',
  'grr.la', 'pokemail.net', 'spamthisplease.com', 'tempmailaddress.com', 'mailforspam.com'
]);

const MX_TIMEOUT_MS = 3000;

const domainOf = (email) => String(email).trim().toLowerCase().split('@').pop() || '';

const isDisposableEmail = (email) => {
  const domain = domainOf(email);
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Subdomains of a throwaway service (e.g. x.mailinator.com).
  return [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith(`.${d}`));
};

const withTimeout = (promise) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), MX_TIMEOUT_MS))]);

/** DNS says this name has no such records (as opposed to DNS being unreachable). */
const isNoData = (error) => ['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(error?.code);

/**
 * false only when DNS clearly answers that the domain can't receive mail
 * (no MX records and no address records to fall back to). true otherwise.
 */
const domainAcceptsMail = async (email) => {
  const domain = domainOf(email);
  if (!domain || !domain.includes('.')) return false;
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    if (mx.some((r) => r.exchange && r.exchange !== '.')) return true;
    // An MX of "." means the domain explicitly accepts no mail.
    if (mx.length) return false;
  } catch (error) {
    if (!isNoData(error)) return true; // DNS trouble: allow
  }
  // No MX: mail can still go to the domain's own address (A/AAAA).
  for (const lookup of [dns.resolve4, dns.resolve6]) {
    try {
      const records = await withTimeout(lookup.call(dns, domain));
      if (records.length) return true;
    } catch (error) {
      if (!isNoData(error)) return true;
    }
  }
  return false;
};

module.exports = { isDisposableEmail, domainAcceptsMail, DISPOSABLE_DOMAINS };
