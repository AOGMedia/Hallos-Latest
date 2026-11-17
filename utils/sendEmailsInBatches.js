/** Emails sent at once — keeps the mail server (and its rate limits) calm. */
const BATCH_SIZE = 5;

/** A short, non-personal label for an error (never its message, which may hold addresses or data). */
const errorCodeOf = (error) =>
  (error && (error.code || error.responseCode || error.name)) || 'unknown error';

/**
 * Send one email per recipient, a few at a time, in the background.
 *
 * Never throws back to the caller: each failure is logged (by user id, not
 * address) and the rest carry on. Returns immediately; sending happens on
 * the next tick so a request that triggered it isn't held up.
 *
 * @param {Array<{ id: *, email: string, firstname?: string }>} recipients
 * @param {(user: Object) => Promise<*>} sendOne
 * @param {string} label - For the log line, e.g. "Series abc schedule"
 */
function sendEmailsInBatches(recipients, sendOne, label) {
  setImmediate(async () => {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((u) => sendOne(u)));
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') {
          sent += 1;
        } else {
          failed += 1;
          // Only the user id and an error code: mail-server messages often
          // contain the recipient's address.
          console.error(`[${label}] Email to user ${batch[j].id} failed (${errorCodeOf(r.reason)})`);
        }
      });
    }
    console.log(`[${label}] ${sent} emails sent, ${failed} failed`);
  });
}

/** Enrolled people who can be emailed, minus the creator themselves. */
const emailableRecipients = (users, creatorId) =>
  (users || []).filter((u) => u && u.email && String(u.id) !== String(creatorId));

module.exports = { sendEmailsInBatches, emailableRecipients, errorCodeOf, BATCH_SIZE };
