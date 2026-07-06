const sequelize = require('../config/db');

async function setup() {
  try {
    console.log('🔔 Setting up notification system tables...\n');

    // notification_preferences
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        instant_live_class_emails BOOLEAN NOT NULL DEFAULT false,
        daily_digest_emails BOOLEAN NOT NULL DEFAULT true,
        weekly_digest_emails BOOLEAN NOT NULL DEFAULT false,
        allow_creator_related_only BOOLEAN NOT NULL DEFAULT true,
        disable_all_emails BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);`);
    console.log('✅ notification_preferences table ready');

    // notification_logs
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_notification_logs_notification_type AS ENUM ('instant', 'daily_digest', 'weekly_digest', 'reminder');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        content_type VARCHAR(50) NOT NULL,
        content_id UUID NOT NULL,
        notification_type enum_notification_logs_notification_type NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_dedup ON notification_logs(user_id, content_id, notification_type);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_notification_logs_content_id ON notification_logs(content_id);`);
    console.log('✅ notification_logs table ready');

    // digest_queue
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_digest_queue_digest_type AS ENUM ('daily', 'weekly');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_digest_queue_status AS ENUM ('pending', 'sent', 'skipped');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS digest_queue (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        content_type VARCHAR(50) NOT NULL,
        content_id UUID NOT NULL,
        digest_type enum_digest_queue_digest_type NOT NULL,
        status enum_digest_queue_status NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(user_id, content_id, digest_type)
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_digest_queue_user_status ON digest_queue(user_id, status, digest_type);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_digest_queue_content_id ON digest_queue(content_id);`);
    console.log('✅ digest_queue table ready');

    console.log('\n🎉 Notification system setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setup();
