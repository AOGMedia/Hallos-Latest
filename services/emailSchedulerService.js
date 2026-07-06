const cron = require('node-cron');
const NotificationService = require('./notificationService');
const digestService = require('./digestService');

/**
 * Email Scheduler Service
 *
 * Manages cron jobs for automated email notifications:
 * - Session reminders (every 15 minutes)
 * - Daily digest (8am UTC daily)
 * - Weekly digest (8am UTC every Monday)
 */

class EmailSchedulerService {
  constructor() {
    this.notificationService = new NotificationService();
    this.jobs = {};
  }

  startSessionReminderJob() {
    const job = cron.schedule('*/15 * * * *', async () => {
      console.log('[Email Scheduler] Running session reminder job...');
      try {
        const result = await this.notificationService.processSessionReminders();
        console.log('[Email Scheduler] Session reminder job completed:', result);
      } catch (error) {
        console.error('[Email Scheduler] Session reminder job error:', error);
      }
    });
    this.jobs.sessionReminder = job;
    console.log('[Email Scheduler] Session reminder job started (every 15 minutes)');
  }

  startDailyDigestJob() {
    // Runs at 8:00 AM UTC every day
    const job = cron.schedule('0 8 * * *', async () => {
      console.log('[Email Scheduler] Running daily digest job...');
      try {
        const result = await digestService.processDailyDigest();
        console.log('[Email Scheduler] Daily digest completed:', result);
      } catch (error) {
        console.error('[Email Scheduler] Daily digest job error:', error);
      }
    });
    this.jobs.dailyDigest = job;
    console.log('[Email Scheduler] Daily digest job started (8am UTC daily)');
  }

  startWeeklyDigestJob() {
    // Runs at 8:00 AM UTC every Monday
    const job = cron.schedule('0 8 * * 1', async () => {
      console.log('[Email Scheduler] Running weekly digest job...');
      try {
        const result = await digestService.processWeeklyDigest();
        console.log('[Email Scheduler] Weekly digest completed:', result);
      } catch (error) {
        console.error('[Email Scheduler] Weekly digest job error:', error);
      }
    });
    this.jobs.weeklyDigest = job;
    console.log('[Email Scheduler] Weekly digest job started (8am UTC every Monday)');
  }

  startAll() {
    console.log('[Email Scheduler] Starting all scheduled jobs...');
    this.startSessionReminderJob();
    this.startDailyDigestJob();
    this.startWeeklyDigestJob();
    console.log('[Email Scheduler] All jobs started successfully');
  }

  stopAll() {
    console.log('[Email Scheduler] Stopping all scheduled jobs...');
    Object.keys(this.jobs).forEach(jobName => {
      if (this.jobs[jobName]) {
        this.jobs[jobName].stop();
        console.log(`[Email Scheduler] Stopped job: ${jobName}`);
      }
    });
    this.jobs = {};
    console.log('[Email Scheduler] All jobs stopped');
  }

  getStatus() {
    return {
      notificationsEnabled: this.notificationService.isEnabled(),
      activeJobs: Object.keys(this.jobs),
      jobCount: Object.keys(this.jobs).length
    };
  }
}

const emailSchedulerService = new EmailSchedulerService();
module.exports = emailSchedulerService;
