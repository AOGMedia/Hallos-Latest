const notificationService = require('./notificationService');
const { sendEmailsInBatches, emailableRecipients, errorCodeOf } = require('../utils/sendEmailsInBatches');

/**
 * Tell everyone registered for a live class (free or paid) that its date or
 * time changed. Starts sending in the background and returns how many people
 * will be emailed; never fails the creator's save.
 *
 * @param {Object} liveClass - LiveClass (after the change)
 * @returns {Promise<number>} People who will get the email
 */
async function notifyLiveClassRescheduled(liveClass) {
  let students = [];
  try {
    students = await notificationService.getLiveClassStudents(liveClass.id);
  } catch (error) {
    console.error(`[Live Class Schedule] Could not load attendees to notify (${errorCodeOf(error)})`);
    return 0;
  }

  const recipients = emailableRecipients(students, liveClass.userId);
  if (recipients.length === 0) return 0;

  const { sendLiveClassRescheduledEmail } = require('../utils/email');
  const details = {
    liveClassId: liveClass.id,
    title: liveClass.title,
    startTime: liveClass.startTime,
    endTime: liveClass.endTime
  };

  sendEmailsInBatches(
    recipients,
    (u) => sendLiveClassRescheduledEmail(u.email, u.firstname, details),
    `Live Class Schedule ${liveClass.id}`
  );

  return recipients.length;
}

module.exports = { notifyLiveClassRescheduled };
