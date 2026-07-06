const sequelize = require('../config/db');

async function setupReferralRevamp() {
  try {
    console.log('🔗 Setting up Referral System Revamp...\n');

    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // ── 1. Alter referral_codes ──────────────────────────────────────────────
    console.log('🔄 Updating referral_codes table...');

    await sequelize.query(`ALTER TABLE referral_codes DROP COLUMN IF EXISTS series_id;`);
    await sequelize.query(`ALTER TABLE referral_codes DROP COLUMN IF EXISTS user_id;`);

    // Add columns WITHOUT inline FK references — avoids FK violation on existing rows with DEFAULT 0
    await sequelize.query(`
      ALTER TABLE referral_codes
        ADD COLUMN IF NOT EXISTS label              VARCHAR(200)  NOT NULL DEFAULT 'Partner Referral',
        ADD COLUMN IF NOT EXISTS partner_user_id    INTEGER       NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS commission_percent DECIMAL(5,2)  NOT NULL DEFAULT 10.00,
        ADD COLUMN IF NOT EXISTS expires_at         TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '3 months'),
        ADD COLUMN IF NOT EXISTS status             VARCHAR(10)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','expired')),
        ADD COLUMN IF NOT EXISTS created_by         INTEGER       NOT NULL DEFAULT 0;
    `);

    // Add FK constraints separately using NOT VALID (skips checking existing rows)
    await sequelize.query(`
      ALTER TABLE referral_codes
        ADD CONSTRAINT IF NOT EXISTS referral_codes_partner_user_id_fkey
        FOREIGN KEY (partner_user_id) REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE RESTRICT
        NOT VALID;
    `).catch(() => {}); // ignore if already exists

    await sequelize.query(`
      ALTER TABLE referral_codes
        ADD CONSTRAINT IF NOT EXISTS referral_codes_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE RESTRICT
        NOT VALID;
    `).catch(() => {}); // ignore if already exists

    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_partner_user_id ON referral_codes(partner_user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_status ON referral_codes(status);`);

    console.log('✅ referral_codes table updated');

    // ── 2. Create user_referrals ─────────────────────────────────────────────
    console.log('🔄 Creating user_referrals table...');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS user_referrals (
        id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        creator_user_id   INTEGER      NOT NULL UNIQUE REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE CASCADE,
        referral_code_id  UUID         NOT NULL REFERENCES referral_codes(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        referral_code     VARCHAR(20)  NOT NULL,
        partner_user_id   INTEGER      NOT NULL REFERENCES "Users"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        signed_up_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        commission_active BOOLEAN      NOT NULL DEFAULT TRUE
      );
    `);

    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_referrals_creator ON user_referrals(creator_user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_referrals_partner        ON user_referrals(partner_user_id);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_referrals_code_id        ON user_referrals(referral_code_id);`);

    console.log('✅ user_referrals table ready');

    // ── 3. Alter referral_commissions ────────────────────────────────────────
    console.log('🔄 Updating referral_commissions table...');

    const dropCols = ['series_id', 'coupon_code', 'status', 'approved_by', 'approved_at', 'paid_at', 'rejection_reason'];
    for (const col of dropCols) {
      await sequelize.query(`ALTER TABLE referral_commissions DROP COLUMN IF EXISTS ${col};`);
    }

    await sequelize.query(`
      ALTER TABLE referral_commissions
        ADD COLUMN IF NOT EXISTS content_type       VARCHAR(50)   NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS content_id         VARCHAR(255),
        ADD COLUMN IF NOT EXISTS commission_percent DECIMAL(5,2)  NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS purchase_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS currency           VARCHAR(3)    NOT NULL DEFAULT 'NGN';
    `);

    // Unique constraint on purchase_id for idempotency
    await sequelize.query(`
      ALTER TABLE referral_commissions
        ADD CONSTRAINT IF NOT EXISTS uq_referral_commissions_purchase_id UNIQUE (purchase_id);
    `).catch(() => {}); // ignore if already exists

    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_referral_commissions_purchase ON referral_commissions(purchase_id);`).catch(() => {});
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions(referrer_user_id);`).catch(() => {});

    console.log('✅ referral_commissions table updated');

    console.log('\n🎉 Referral system revamp setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setupReferralRevamp();
