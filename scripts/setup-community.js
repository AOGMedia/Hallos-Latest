const sequelize = require('../config/db');

async function setupCommunity() {
  try {
    console.log('Setting up Community tables...\n');

    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // communities
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS communities (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        thumbnail_url TEXT,
        cover_image_url TEXT,
        type VARCHAR(20) NOT NULL CHECK (type IN ('school','association','committee','general')),
        visibility VARCHAR(10) NOT NULL CHECK (visibility IN ('public','private')),
        join_policy VARCHAR(15) NOT NULL DEFAULT 'request' CHECK (join_policy IN ('request','invite_only')),
        status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','rejected')),
        created_by INTEGER NOT NULL REFERENCES "Users"(id),
        invite_token VARCHAR(64) UNIQUE NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_communities_status_visibility ON communities(status, visibility);`);
    console.log('communities table ready');

    // community_members
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS community_members (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
        role VARCHAR(10) NOT NULL CHECK (role IN ('owner','moderator','member')),
        status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('active','pending','banned')),
        joined_at TIMESTAMPTZ,
        invited_by INTEGER REFERENCES "Users"(id),
        email_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (community_id, user_id)
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_community_members_community_id ON community_members(community_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_community_members_user_id ON community_members(user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_community_members_status ON community_members(community_id, status);`);
    console.log('community_members table ready');

    // community_announcements
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS community_announcements (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        created_by INTEGER NOT NULL REFERENCES "Users"(id),
        title VARCHAR(300) NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        is_pinned BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_community_announcements_community_id ON community_announcements(community_id);`);
    console.log('community_announcements table ready');

    // community_content_submissions
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS community_content_submissions (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        submitted_by INTEGER NOT NULL REFERENCES "Users"(id),
        content_type VARCHAR(15) NOT NULL CHECK (content_type IN ('live_class','live_series','video','freebie')),
        content_data JSONB NOT NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','resubmitted')),
        rejection_reason TEXT,
        reviewed_by INTEGER REFERENCES "Users"(id),
        reviewed_at TIMESTAMPTZ,
        community_visibility VARCHAR(15) NOT NULL DEFAULT 'community_only' CHECK (community_visibility IN ('community_only','public')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_community_content_submissions_community_id ON community_content_submissions(community_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_community_content_submissions_status ON community_content_submissions(community_id, status);`);
    console.log('community_content_submissions table ready');

    // Add community columns to existing content tables (safe - IF NOT EXISTS equivalent via DO block)
    const contentTables = ['live_classes', 'live_series', 'videos', 'freebies'];
    for (const table of contentTables) {
      await sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = '${table}' AND column_name = 'community_id'
          ) THEN
            ALTER TABLE ${table} ADD COLUMN community_id UUID REFERENCES communities(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);
      await sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = '${table}' AND column_name = 'community_visibility'
          ) THEN
            ALTER TABLE ${table} ADD COLUMN community_visibility VARCHAR(20) CHECK (community_visibility IN ('community_only','public'));
          END IF;
        END $$;
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_${table}_community_id ON ${table}(community_id);`);
      console.log(`${table} updated with community columns`);
    }

    console.log('\nCommunity setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('Setup failed:', error.message);
    process.exit(1);
  }
}

setupCommunity();
