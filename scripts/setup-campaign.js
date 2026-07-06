const sequelize = require('../config/db');

async function setupCampaign() {
  try {
    console.log('Setting up Campaign Registration table...\n');

    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // campaign_registrations
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS campaign_registrations (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        location VARCHAR(100) NOT NULL,
        talent VARCHAR(100) NOT NULL,
        job_description TEXT,
        what_to_learn TEXT,
        payment_reference VARCHAR(255) UNIQUE,
        payment_status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed')),
        payment_gateway VARCHAR(20) NOT NULL DEFAULT 'paystack',
        amount DECIMAL(10, 2) NOT NULL DEFAULT 2000.00,
        currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
        email_sent BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('campaign_registrations table ready');

    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_campaign_registrations_email ON campaign_registrations(email);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_campaign_registrations_status ON campaign_registrations(payment_status);`);
    console.log('Indexes created');

    console.log('\nCampaign setup complete!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('Setup failed:', error.message);
    process.exit(1);
  }
}

setupCampaign();
