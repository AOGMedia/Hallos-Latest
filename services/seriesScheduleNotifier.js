const notificationService = require('./notificationService');
const { sendEmailsInBatches, emailableRecipients, errorCodeOf } = require('../utils/sendEmailsInBatches');

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
    console.error(`[Series Schedule] Could not load attendees to notify (${errorCodeOf(error)})`);
    return 0;
  }

  const recipients = emailableRecipients(students, series.userId);
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

  sendEmailsInBatches(
    recipients,
    (u) => sendSeriesScheduleChangedEmail(u.email, u.firstname, details),
    `Series Schedule ${series.id}`
  );

  return recipients.length;
}

module.exports = { notifyScheduleChanged };
