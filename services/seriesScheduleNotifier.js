const notificationService = require('./notificationService');

/** Emails sent at once — keeps the mail server (and its rate limits) calm. */
const BATCH_SIZE = 5;

/**
 * Tell everyone enrolled in a series (paid or free) that its schedule changed.
 *
 * Looks up who to tell, starts sending in the background and returns how many
 * people will be emailed. Sending never holds up or fails the creator's save:
 * a failed email is logged and the rest carry on.
 *
 * @param {Object} series - LiveSeries (after the change)
 * @param {Object|null} nextSession - { sessionNumber, scheduledStartTime }
 * @returns {Promise<number>} People who will get the email
 */
async function notifyScheduleChanged(series, nextSession) {
  let students = [];
  try {
    students = await notificationService.getEnrolledStudents(series.id);
  } catch (error) {
    console.error('[Series Schedule] Could not load attendees to notify:', error.message);
    return 0;
  }

  const recipients = students.filter((u) => u && u.email && String(u.id) !== String(series.userId));
  if (recipients.length === 0) return 0;

  const { sendSeriesScheduleChangedEmail } = require('../utils/email');
  const pattern = typeof series.recurrencePattern === 'string'
    ? JSON.parse(series.recurrencePattern)
    : series.recurrencePattern || {};
  const details = {
    seriesId: series.id,
    seriesTitle: series.title,
    days: pattern.days || [],
    nextSessionStart: nextSession ? nextSession.scheduledStartTime : null,
    nextSessionNumber: nextSession ? nextSession.sessionNumber : null
  };

  setImmediate(async () => {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((u) => sendSeriesScheduleChangedEmail(u.email, u.firstname, details))
      );
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') {
          sent += 1;
        } else {
          failed += 1;
          console.error(`[Series Schedule] Email to user ${batch[j].id} failed:`, r.reason && r.reason.message);
        }
      });
    }
    console.log(`[Series Schedule] Series ${series.id}: ${sent} schedule emails sent, ${failed} failed`);
  });

  return recipients.length;
}

module.exports = { notifyScheduleChanged };
