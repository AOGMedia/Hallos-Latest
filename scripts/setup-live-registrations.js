const sequelize = require('../config/db');

async function setup() {
  try {
    console.log('🎯 Setting up live registrations table...\n');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS live_series_registrations (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        series_id UUID NOT NULL REFERENCES live_series(id) ON UPDATE CASCADE ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(series_id, user_id)
      );
    `);
    console.log('✅ live_series_registrations table ready');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_live_series_registrations_series_id
      ON live_series_registrations(series_id);
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_live_series_registrations_user_id
      ON live_series_registrations(user_id);
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 Live registrations setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setup();
