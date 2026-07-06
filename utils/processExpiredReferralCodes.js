const referralService = require('../services/referralService');

async function run() {
  const result = await referralService.processExpiredCodes();
  console.log(`[Cron] Expired ${result.expiredCount} referral codes`);
  if (result.errors && result.errors.length > 0) {
    result.errors.forEach(e => console.error('[Cron] Error:', e));
  }
}

run().catch(err => {
  console.error('[Cron] processExpiredReferralCodes failed:', err.message);
  process.exit(1);
});

module.exports = run;
