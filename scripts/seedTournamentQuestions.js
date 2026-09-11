/**
 * Seed general-knowledge quiz questions from a CSV file directly into the DB.
 *
 * Bypasses the admin upload HTTP route entirely (no multer, no S3 archival —
 * that step is optional/best-effort in questionService anyway) but reuses
 * the *exact* same parsing, validation, and duplicate-detection logic as a
 * real admin upload would, by calling into questionService directly. This
 * guarantees the seeded rows are indistinguishable from ones uploaded through
 * the real UI.
 *
 * Usage:
 *   node scripts/seedTournamentQuestions.js [csvPath] [categoryName]
 *
 * Env:
 *   SEED_ADMIN_USER_ID - user id to attribute questions to (createdBy).
 *                         Falls back to the first user with role='admin'.
 *
 * Requires DB_USER/DB_PASS/DB_NAME/DB_HOST/DB_PORT (or however config/db.js
 * is wired) to already point at the target database — same as any other
 * script in this repo.
 */

const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const sequelize = require('../config/db');
const QuizCategory = require('../models/QuizCategory');
const User = require('../models/User');
const questionService = require('../services/questionService');

const DEFAULT_CSV_PATH = path.join(__dirname, '..', 'data', 'general-knowledge-questions.csv');
const DEFAULT_CATEGORY_NAME = 'General Knowledge';

async function resolveAdminId() {
  if (process.env.SEED_ADMIN_USER_ID) {
    return parseInt(process.env.SEED_ADMIN_USER_ID, 10);
  }
  const admin = await User.findOne({ where: { role: 'admin' }, order: [['id', 'ASC']] });
  if (!admin) {
    throw new Error(
      'No admin user found and SEED_ADMIN_USER_ID not set. ' +
      'Pass an existing user id via: SEED_ADMIN_USER_ID=<id> node scripts/seedTournamentQuestions.js'
    );
  }
  return admin.id;
}

async function resolveCategory(name) {
  const [category, created] = await QuizCategory.findOrCreate({
    where: { name },
    defaults: {
      name,
      description: `Seeded category for tournament testing — general knowledge trivia across science, geography, history, sports, and pop culture.`,
      isActive: true
    }
  });
  console.log(created ? `[Seed] Created category "${name}" (${category.id})` : `[Seed] Using existing category "${name}" (${category.id})`);
  return category;
}

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV_PATH;
  const categoryName = process.argv[3] || DEFAULT_CATEGORY_NAME;

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  await sequelize.authenticate();
  console.log('[Seed] DB connection OK');

  const adminId = await resolveAdminId();
  console.log(`[Seed] Attributing questions to user id ${adminId}`);

  const category = await resolveCategory(categoryName);

  const fileBuffer = fs.readFileSync(csvPath);

  // Reuse questionService.uploadQuestions verbatim — same parsing (xlsx reads
  // CSV fine), same validateQuestionRow rules, same detectDuplicate (pg_trgm
  // similarity), same QuizQuestion.create call, same questionCount increment.
  // The only difference from a real admin upload is skipping the S3 archival
  // (that call is best-effort inside uploadQuestions anyway and will just log
  // a warning and continue if S3 isn't configured).
  const result = await questionService.uploadQuestions(adminId, fileBuffer, category.id, path.basename(csvPath));

  console.log('\n[Seed] Result:');
  console.log(`  Added:      ${result.questionsAdded}`);
  console.log(`  Duplicates: ${result.duplicatesSkipped}`);
  console.log(`  Errors:     ${result.errors.length}`);
  if (result.errors.length > 0) {
    result.errors.forEach(e => console.log(`    Row ${e.row}: ${e.error}`));
  }

  // Verify there's enough depth per difficulty for selectBalancedQuestions
  // (needs at least 4 easy + 4 medium + 2 hard per round).
  const { Op } = require('sequelize');
  const QuizQuestion = require('../models/QuizQuestion');
  const counts = await QuizQuestion.findAll({
    where: { categoryId: category.id, isActive: true },
    attributes: ['difficulty', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['difficulty'],
    raw: true
  });
  console.log('\n[Seed] Question bank depth for this category:');
  counts.forEach(c => console.log(`  ${c.difficulty}: ${c.count}`));

  const easyCount = parseInt(counts.find(c => c.difficulty === 'easy')?.count || 0, 10);
  const mediumCount = parseInt(counts.find(c => c.difficulty === 'medium')?.count || 0, 10);
  const hardCount = parseInt(counts.find(c => c.difficulty === 'hard')?.count || 0, 10);
  const roundsSupportable = Math.min(Math.floor(easyCount / 4), Math.floor(mediumCount / 4), Math.floor(hardCount / 2));
  console.log(`\n[Seed] Category "${category.name}" (${category.id}) can support ~${roundsSupportable} full 10-question rounds without repeating a question.`);

  console.log('\n[Seed] Done.');
  await sequelize.close();
}

main().catch(err => {
  console.error('[Seed] Fatal error:', err);
  process.exit(1);
});
