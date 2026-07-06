const sequelize = require('../config/db');

async function run() {
  try {
    console.log('🔧 Adding "expired" to quiz_matches status enum...\n');

    await sequelize.query(
      `ALTER TYPE "enum_quiz_matches_status" ADD VALUE IF NOT EXISTS 'expired'`
    );

    console.log('✅ Done! "expired" status added to quiz_matches.');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

run();
