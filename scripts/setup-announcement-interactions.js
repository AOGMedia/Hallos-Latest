const sequelize = require('../config/db');

async function setup() {
  try {
    console.log('💬 Setting up announcement interactions...\n');

    // Add liked_by column to community_announcements
    await sequelize.query(`
      ALTER TABLE community_announcements
      ADD COLUMN IF NOT EXISTS liked_by JSONB NOT NULL DEFAULT '[]';
    `);
    console.log('✅ liked_by column added to community_announcements');

    // Create community_announcement_comments table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS community_announcement_comments (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        announcement_id UUID NOT NULL REFERENCES community_announcements(id) ON UPDATE CASCADE ON DELETE CASCADE,
        community_id UUID NOT NULL REFERENCES communities(id) ON UPDATE CASCADE ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    console.log('✅ community_announcement_comments table ready');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_announcement_comments_announcement_id
      ON community_announcement_comments(announcement_id);
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_announcement_comments_user_id
      ON community_announcement_comments(user_id);
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 Announcement interactions setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setup();
