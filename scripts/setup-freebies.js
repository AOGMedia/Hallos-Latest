const sequelize = require('../config/db');

async function setupFreebies() {
  try {
    console.log('📚 Setting up Freebies tables...\n');

    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // freebies
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS freebies (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        thumbnail_url TEXT,
        estimated_reading_time INTEGER NOT NULL CHECK (estimated_reading_time > 0),
        download_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_freebies_user ON freebies(user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_freebies_created ON freebies(created_at DESC);`);
    console.log('✅ freebies table ready');

    // freebie_items
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS freebie_items (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        freebie_id UUID NOT NULL REFERENCES freebies(id) ON UPDATE CASCADE ON DELETE CASCADE,
        item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('file', 'link')) DEFAULT 'file',
        file_name VARCHAR(255),
        file_type VARCHAR(100),
        file_size BIGINT,
        s3_key TEXT,
        file_url TEXT,
        link_url TEXT,
        link_title VARCHAR(255),
        download_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_freebie_items_freebie ON freebie_items(freebie_id);`);
    console.log('✅ freebie_items table ready');

    // freebie_downloads
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS freebie_downloads (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        freebie_id UUID NOT NULL REFERENCES freebies(id) ON UPDATE CASCADE ON DELETE CASCADE,
        freebie_item_id UUID NOT NULL REFERENCES freebie_items(id) ON UPDATE CASCADE ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_freebie_downloads_user ON freebie_downloads(user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_freebie_downloads_item ON freebie_downloads(freebie_item_id);`);
    console.log('✅ freebie_downloads table ready');

    console.log('\n🎉 Freebies setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setupFreebies();
