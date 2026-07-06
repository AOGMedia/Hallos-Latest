const { LiveSession, LiveSeries } = require('../models/liveSeriesIndex');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const { sendSessionReminderEmail } = require('../utils/email');
const { Op } = require('sequelize');

/**
 * Manual script to send session reminders for a specific series
 * Usage: node scripts/sendSessionReminder.js <seriesId>
 */

async function sendRemindersForSeries(seriesId) {
  try {
    console.log(`\n🔔 Sending session reminders for series: ${seriesId}\n`);

    // Get the session for March 7th, 2026 specifically
    const march7Start = new Date('2026-03-07T00:00:00');
    const march7End = new Date('2026-03-07T23:59:59');
    
    const session = await LiveSession.findOne({
      where: {
        seriesId: seriesId,
        scheduledStartTime: {
          [Op.gte]: march7Start,
          [Op.lte]: march7End
        }
      },
      include: [{
        model: LiveSeries,
        as: 'series',
        attributes: ['id', 'title', 'userId', 'thumbnailUrl']
      }],
      order: [['scheduledStartTime', 'ASC']]
    });

    if (!session) {
      console.log('❌ No session found for March 7th, 2026 for this series');
      return;
    }

    console.log(`📅 Found session: #${session.sessionNumber} - ${session.series.title}`);
    console.log(`⏰ Scheduled for: ${session.scheduledStartTime}`);

    // Get all students who purchased this series
    const purchases = await Purchase.findAll({
      where: {
        contentType: 'live_series',
        contentId: seriesId,
        paymentStatus: 'completed'
      },
      attributes: ['userId']
    });

    const userIds = [...new Set(purchases.map(p => p.userId))];

    if (userIds.length === 0) {
      console.log('❌ No enrolled students found for this series');
      return;
    }

    // Get user details
    const users = await User.findAll({
      where: {
        id: {
          [Op.in]: userIds
        }
      },
      attributes: ['id', 'email', 'firstname', 'lastname']
    });

    console.log(`\n👥 Found ${users.length} enrolled students\n`);

    // Prepare session data
    const sessionData = {
      sessionId: session.id,
      seriesId: seriesId, // Add seriesId for the join link
      sessionNumber: session.sessionNumber,
      seriesTitle: session.series.title,
      scheduledStartTime: session.scheduledStartTime,
      scheduledEndTime: session.scheduledEndTime,
      thumbnailUrl: session.series.thumbnailUrl
    };

    // Send emails
    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await sendSessionReminderEmail(
          user.email,
          user.firstname,
          sessionData
        );
        console.log(`✅ Sent to: ${user.email}`);
        sent++;
      } catch (error) {
        console.error(`❌ Failed to send to ${user.email}:`, error.message);
        failed++;
      }
    }

    console.log(`\n📊 Results:`);
    console.log(`   ✅ Sent: ${sent}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📧 Total: ${users.length}\n`);

    // Mark session as reminder sent
    await session.update({ reminderSent: true });
    console.log('✓ Marked March 7th session as reminder sent\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Get series ID from command line
const seriesId = process.argv[2];

if (!seriesId) {
  console.error('❌ Please provide a series ID');
  console.log('Usage: node scripts/sendSessionReminder.js <seriesId>');
  process.exit(1);
}

// Run the script
sendRemindersForSeries(seriesId)
  .then(() => {
    console.log('✓ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
