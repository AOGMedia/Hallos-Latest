require('dotenv').config();
const { LiveSession, LiveSeries } = require('../models/liveSeriesIndex');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const { sendSessionReminderEmail } = require('../utils/email');
const { Op } = require('sequelize');

const SERIES_ID = 'f0e13348-6550-46df-88a0-66905d72a913';
const SESSION_NUMBER = 9;

async function sendCapcutReminder() {
  try {
    console.log('Fetching CapCut series and session 9...\n');

    // Get the series
    const series = await LiveSeries.findByPk(SERIES_ID);
    if (!series) {
      console.error('Series not found. Check the SERIES_ID.');
      process.exit(1);
    }
    console.log(`Series: ${series.title}`);

    // Get session 9
    const session = await LiveSession.findOne({
      where: { seriesId: SERIES_ID, sessionNumber: SESSION_NUMBER }
    });
    if (!session) {
      console.error(`Session ${SESSION_NUMBER} not found for this series.`);
      process.exit(1);
    }
    console.log(`Session ${SESSION_NUMBER} scheduled: ${session.scheduledStartTime}\n`);

    // Get all enrolled students (completed purchases)
    const purchases = await Purchase.findAll({
      where: {
        contentType: 'live_series',
        contentId: SERIES_ID,
        paymentStatus: 'completed'
      },
      attributes: ['userId']
    });

    const userIds = [...new Set(purchases.map(p => p.userId))];
    console.log(`Found ${userIds.length} enrolled students\n`);

    if (userIds.length === 0) {
      console.log('No enrolled students found. Exiting.');
      process.exit(0);
    }

    const users = await User.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ['id', 'email', 'firstname']
    });

    // Build session data — same shape as the cron job uses
    const sessionData = {
      sessionId: session.id,
      seriesId: SERIES_ID,
      sessionNumber: SESSION_NUMBER,
      seriesTitle: series.title,
      scheduledStartTime: session.scheduledStartTime,
      scheduledEndTime: session.scheduledEndTime,
      thumbnailUrl: series.thumbnailUrl
    };

    // Send reminders
    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await sendSessionReminderEmail(user.email, user.firstname, sessionData);
        console.log(`Sent to ${user.email}`);
        sent++;
      } catch (err) {
        console.error(`Failed for ${user.email}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
    console.log('The normal 1-hour cron reminder will still fire as usual on Saturday.');
    process.exit(0);
  } catch (err) {
    console.error('Script error:', err.message);
    process.exit(1);
  }
}

sendCapcutReminder();
