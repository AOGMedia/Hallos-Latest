const sequelize = require('../config/db');

async function fixQuizAnswersSchema() {
  try {
    console.log('🛠️ Fixing quiz_match_answers table schema...\n');

    // 1. Drop the restrictive check constraint if it exists
    await sequelize.query(`
      ALTER TABLE quiz_match_answers 
      DROP CONSTRAINT IF EXISTS quiz_match_answers_selected_answer_check;
    `);
    console.log('✅ Dropped old check constraint');

    // 2. Change selected_answer to VARCHAR(7) to fit 'timeout'
    await sequelize.query(`
      ALTER TABLE quiz_match_answers 
      ALTER COLUMN selected_answer TYPE VARCHAR(7);
    `);
    console.log('✅ Increased selected_answer column size to 7');

    // 3. Change response_time to DECIMAL(10, 3) to fit float values (e.g. 0.359)
    await sequelize.query(`
      ALTER TABLE quiz_match_answers 
      ALTER COLUMN response_time TYPE DECIMAL(10, 3) USING response_time::DECIMAL(10, 3);
    `);
    console.log('✅ Updated response_time to DECIMAL(10, 3)');

    try {
      await sequelize.query(`
        ALTER TABLE quiz_match_answers 
        ALTER COLUMN client_timestamp TYPE BIGINT USING EXTRACT(EPOCH FROM client_timestamp)::BIGINT * 1000;
        ALTER TABLE quiz_match_answers 
        ALTER COLUMN server_timestamp TYPE BIGINT USING EXTRACT(EPOCH FROM server_timestamp)::BIGINT * 1000;
      `);
      console.log('✅ Timestamps converted from TIMESTAMP to BIGINT');
    } catch (err) {
      // If it fails with 'extract' doesn't exist, it likely means they are already BIGINTs
      if (err.message.includes('extract') || err.message.includes('cannot be cast automatically')) {
        console.log('ℹ️ Timestamps are already in numeric format, skipping conversion.');
      } else {
        console.warn('⚠️ Timestamp update encountered an expected state: ' + err.message);
      }
    }

    // 5. Add a new check constraint that allows 'a', 'b', 'c', 'd' AND 'timeout'
    await sequelize.query(`
      ALTER TABLE quiz_match_answers 
      ADD CONSTRAINT quiz_match_answers_selected_answer_check 
      CHECK (selected_answer IN ('a', 'b', 'c', 'd', 'timeout'));
    `);
    console.log('✅ Added new valid check constraint');

    console.log('\n🎉 Quiz Answers schema fixed successfully!');
    console.log('Run: pm2 restart backend');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    process.exit(1);
  }
}

fixQuizAnswersSchema();
