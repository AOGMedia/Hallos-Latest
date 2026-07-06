const sequelize = require('../config/db');

async function setupCampaignQuiz() {
  try {
    console.log('Setting up Campaign Quiz tables...\n');

    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // campaign_quiz_sessions — one per paid registrant
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS campaign_quiz_sessions (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        registration_id UUID NOT NULL UNIQUE REFERENCES campaign_registrations(id),
        user_id INTEGER REFERENCES "Users"(id),
        email VARCHAR(255) NOT NULL,
        access_token VARCHAR(64) NOT NULL UNIQUE,
        token_expires_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'active', 'completed', 'expired')),
        category_id UUID,
        questions JSONB NOT NULL DEFAULT '[]',
        session_data JSONB NOT NULL DEFAULT '{}',
        score INTEGER,
        total_correct INTEGER,
        total_time_ms BIGINT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        result_email_sent BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('campaign_quiz_sessions table ready');

    // campaign_quiz_answers — immutable, one row per question per session
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS campaign_quiz_answers (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES campaign_quiz_sessions(id),
        question_id UUID NOT NULL REFERENCES quiz_questions(id),
        question_index INTEGER NOT NULL,
        selected_answer VARCHAR(7) NOT NULL,
        is_correct BOOLEAN NOT NULL,
        response_time_ms INTEGER NOT NULL,
        client_timestamp BIGINT,
        server_timestamp BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, question_index)
      );
    `);
    console.log('campaign_quiz_answers table ready');

    // Indexes
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cqs_status ON campaign_quiz_sessions(status);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cqs_score ON campaign_quiz_sessions(score DESC NULLS LAST, total_time_ms ASC NULLS LAST);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cqs_token ON campaign_quiz_sessions(access_token);`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cqa_session ON campaign_quiz_answers(session_id);`);
    console.log('Indexes created');

    console.log('\nCampaign quiz setup complete!');
    console.log('Next steps:');
    console.log('  1. Add CAMPAIGN_QUIZ_CATEGORY_ID=<uuid> to your .env');
    console.log('  2. pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('Setup failed:', error.message);
    process.exit(1);
  }
}

setupCampaignQuiz();
