const sequelize = require('./config/db');

async function setupCouponSystem() {
  try {
    console.log('🎟️  Setting up Coupon System tables...\n');

    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // coupons table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        code VARCHAR(50) NOT NULL,
        type VARCHAR(10) NOT NULL CHECK (type IN ('partner', 'creator')),
        discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
        discount_value DECIMAL(10, 2) NOT NULL CHECK (discount_value >= 0),
        partner_user_id INTEGER REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE SET NULL,
        partner_commission_percent DECIMAL(5, 2) CHECK (partner_commission_percent >= 0 AND partner_commission_percent <= 100),
        creator_id INTEGER REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        applicable_content_types TEXT[] NOT NULL,
        specific_content_ids TEXT[],
        status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
        usage_limit INTEGER CHECK (usage_limit > 0),
        usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
        starts_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        CONSTRAINT valid_partner_coupon CHECK (
          type != 'partner' OR (partner_user_id IS NOT NULL AND partner_commission_percent IS NOT NULL)
        ),
        CONSTRAINT valid_creator_coupon CHECK (
          type != 'creator' OR creator_id IS NOT NULL
        ),
        CONSTRAINT valid_date_range CHECK (
          expires_at IS NULL OR expires_at > starts_at
        ),
        CONSTRAINT valid_usage_limit CHECK (
          usage_limit IS NULL OR usage_count <= usage_limit
        ),
        CONSTRAINT valid_percentage_discount CHECK (
          discount_type != 'percentage' OR (discount_value >= 0 AND discount_value <= 100)
        )
      );
    `);
    
    // Create indexes for coupons table
    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code_upper ON coupons(UPPER(code));`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupons_type ON coupons(type);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupons_creator ON coupons(creator_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupons_partner ON coupons(partner_user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupons_expires ON coupons(expires_at) WHERE status = 'active';`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupons_content_types ON coupons USING GIN(applicable_content_types);`);
    console.log('✅ coupons table ready');

    // coupon_usage table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS coupon_usage (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        coupon_id UUID NOT NULL REFERENCES coupons(id) ON UPDATE CASCADE ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        purchase_id UUID NOT NULL REFERENCES purchases(id) ON UPDATE CASCADE ON DELETE CASCADE,
        original_price DECIMAL(10, 2) NOT NULL CHECK (original_price >= 0),
        discount_amount DECIMAL(10, 2) NOT NULL CHECK (discount_amount >= 0),
        final_price DECIMAL(10, 2) NOT NULL CHECK (final_price >= 0),
        partner_commission_amount DECIMAL(10, 2) CHECK (partner_commission_amount >= 0),
        content_type VARCHAR(50) NOT NULL,
        content_id UUID,
        currency VARCHAR(3) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        CONSTRAINT valid_prices CHECK (
          discount_amount <= original_price AND final_price = original_price - discount_amount
        ),
        CONSTRAINT valid_partner_commission CHECK (
          partner_commission_amount IS NULL OR partner_commission_amount <= original_price
        )
      );
    `);
    
    // Create indexes for coupon_usage table
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_usage_coupon ON coupon_usage(coupon_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_usage_user ON coupon_usage(user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_usage_purchase ON coupon_usage(purchase_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_usage_created ON coupon_usage(created_at DESC);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_usage_content ON coupon_usage(content_type, content_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_usage_currency ON coupon_usage(currency);`);
    console.log('✅ coupon_usage table ready');

    // coupon_audit_log table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS coupon_audit_log (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        coupon_id UUID NOT NULL REFERENCES coupons(id) ON UPDATE CASCADE ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('create', 'update', 'delete', 'activate', 'deactivate')),
        old_values JSONB,
        new_values JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    
    // Create indexes for coupon_audit_log table
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_audit_coupon ON coupon_audit_log(coupon_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_audit_user ON coupon_audit_log(user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_coupon_audit_created ON coupon_audit_log(created_at DESC);`);
    console.log('✅ coupon_audit_log table ready');

    // Add coupon_id to purchases table
    await sequelize.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'purchases' AND column_name = 'coupon_id'
        ) THEN
          ALTER TABLE purchases ADD COLUMN coupon_id UUID REFERENCES coupons(id) ON UPDATE CASCADE ON DELETE SET NULL;
          CREATE INDEX idx_purchases_coupon ON purchases(coupon_id);
        END IF;
      END $$;
    `);
    console.log('✅ purchases table updated with coupon_id');

    console.log('\n🎉 Coupon System setup complete!');
    console.log('Next steps:');
    console.log('1. Run: node scripts/migrate-hardcoded-coupons.js (to migrate old coupons)');
    console.log('2. Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

setupCouponSystem();
