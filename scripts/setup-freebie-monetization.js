const sequelize = require('./config/db');

async function setupFreebieMonetization() {
  try {
    console.log('💰 Setting up Freebie Monetization tables...\n');

    // ── 1. Add price and currency to freebies ────────────────────────────────
    await sequelize.query(`
      ALTER TABLE freebies
        ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'NGN';
    `);
    console.log('✅ freebies: added price and currency columns');

    // ── 2. Add is_free_preview to freebie_items ──────────────────────────────
    await sequelize.query(`
      ALTER TABLE freebie_items
        ADD COLUMN IF NOT EXISTS is_free_preview BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log('✅ freebie_items: added is_free_preview column');

    // ── 3. Create freebie_access table ───────────────────────────────────────
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS freebie_access (
        id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        freebie_id    UUID NOT NULL REFERENCES freebies(id) ON UPDATE CASCADE ON DELETE CASCADE,
        purchase_reference VARCHAR(255) NOT NULL,
        amount_paid   DECIMAL(10, 2) NOT NULL,
        currency      VARCHAR(3) NOT NULL,
        coupon_id     UUID NULL REFERENCES coupons(id) ON UPDATE CASCADE ON DELETE SET NULL,
        created_at    TIMESTAMP DEFAULT NOW() NOT NULL,
        CONSTRAINT uq_freebie_access_user_freebie UNIQUE (user_id, freebie_id)
      );
    `);
    console.log('✅ freebie_access table created');

    // ── 4. Indexes on freebie_access ─────────────────────────────────────────
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_freebie_access_user_id    ON freebie_access(user_id);
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_freebie_access_freebie_id ON freebie_access(freebie_id);
    `);
    console.log('✅ freebie_access: indexes created');

    console.log('\n🎉 Freebie Monetization setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setupFreebieMonetization();
