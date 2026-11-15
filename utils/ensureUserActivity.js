const sequelize = require('../config/db');

/**
 * Daily activity storage for active users and retention. Runs on boot like
 * the other ensure* helpers: safe to run again and never throws. If it can't
 * run, activity simply isn't recorded.
 *
 * The first time (empty table) it seeds history from what already has dates
 * — the day each person signed up and the days they bought something — so the
 * charts aren't empty on day one. Later days come from real use.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_daily_activity (
    user_id INTEGER NOT NULL,
    day DATE NOT NULL,
    PRIMARY KEY (day, user_id)
  )`,
  'CREATE INDEX IF NOT EXISTS user_daily_activity_user ON user_daily_activity (user_id, day)',
];

async function seedHistory() {
  const [[{ empty }]] = await sequelize.query('SELECT NOT EXISTS (SELECT 1 FROM user_daily_activity) AS empty');
  if (!empty) return;
  await sequelize.query(
    `INSERT INTO user_daily_activity (user_id, day)
     SELECT id, ("createdAt" AT TIME ZONE 'UTC')::date FROM "Users" WHERE "createdAt" IS NOT NULL
     ON CONFLICT DO NOTHING`
  );
  await sequelize.query(
    `INSERT INTO user_daily_activity (user_id, day)
     SELECT DISTINCT user_id, (created_at AT TIME ZONE 'UTC')::date FROM purchases
      WHERE payment_status::text IN ('completed', 'refunded') AND user_id IS NOT NULL
     ON CONFLICT DO NOTHING`
  );
  console.log('✅ Activity history seeded from sign-ups and purchases');
}

async function ensureUserActivity() {
  try {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement);
    }
    await seedHistory();
    require('../services/activityTrackingService').start();
    console.log('✅ Activity tracking ready');
  } catch (error) {
    console.error('⚠️ Activity tracking setup failed; active users are not recorded:', error.message);
  }
}

module.exports = { ensureUserActivity };
