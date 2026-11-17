const sequelize = require('../config/db');

/**
 * Profiles on the investor relations page (/investor-relations), edited from
 * the admin. Created on boot like the other ensure* helpers: safe to repeat,
 * never throws. The first time the table is created it's filled with the
 * profile the page showed before this was editable, so nothing changes on the
 * site until staff edit it. If this can't run, the site keeps that profile.
 */
const SEED = {
  name: 'Morgan Martinez',
  role: 'Social Advocate',
  location: 'Lagos, Nigeria',
  websiteLabel: 'morganbridgeconsulting.com',
  websiteUrl: 'https://morganbridgeconsulting.com',
  imageUrl: '/images/investor-elizabeth.png',
  bio: `Born in Ghana and having lived in the United States for 41 years, she brings a unique blend of global perspective and deep cultural insight to her work. Morgan has built a stellar career marked by leadership in infrastructure design and deployment, quality management, and IT services for major organizations across six continents.

Her entrepreneurial footprint extends beyond the borders of the United States, with strategic investments and business ventures across Africa. Her mission-driven approach focuses on employment generation and social re-engineering, particularly on the African continent where her impact is visible in major urban centers.

Throughout her career, she has collaborated with both for-profit and non-profit organizations, including international government agencies, to drive innovation, empowerment, and sustainable growth. Her ability to connect business with purpose has made her a respected leader in philanthropy, especially in initiatives that support youth development and vulnerable populations across Africa and other developing regions. Morgan is passionate about using business as a force for good. Her compassion, coupled with an unwavering dedication to community development, continues to inspire change and foster progress globally.

Morgan is currently working on a project for AWS, Microsoft, Oracle, Meta, and OpenAI and other major IT companies to build 1,200 hyper scale data centers all across Africa.`,
};

let ready = false;

async function ensureInvestorRelations() {
  try {
    const [[existing]] = await sequelize.query("SELECT to_regclass('public.investor_profiles') IS NOT NULL AS present");
    await sequelize.query(`CREATE TABLE IF NOT EXISTS investor_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(120) NOT NULL,
      role VARCHAR(80) NOT NULL,
      location VARCHAR(120),
      website_label VARCHAR(120),
      website_url VARCHAR(500),
      email VARCHAR(255),
      linkedin_url VARCHAR(500),
      image_url VARCHAR(500) NOT NULL,
      bio TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await sequelize.query('CREATE INDEX IF NOT EXISTS investor_profiles_order ON investor_profiles (is_published, position)');
    if (!existing.present) {
      await sequelize.query(
        `INSERT INTO investor_profiles (name, role, location, website_label, website_url, image_url, bio, position)
         VALUES (:name, :role, :location, :websiteLabel, :websiteUrl, :imageUrl, :bio, 0)`,
        { replacements: SEED }
      );
    }
    ready = true;
    console.log('✅ Investor relations profiles ready');
  } catch (error) {
    console.error('⚠️ Investor relations setup failed; the page keeps its built-in profile:', error.message);
  }
}

module.exports = { ensureInvestorRelations, isInvestorRelationsReady: () => ready };
