const sequelize = require('../config/db');

async function run() {
  try {
    console.log('🔄 Adding freebie to purchases content_type enum...');
    await sequelize.query(`ALTER TYPE "enum_purchases_content_type" ADD VALUE IF NOT EXISTS 'freebie';`);
    console.log('✅ Done!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

run();
