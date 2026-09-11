/**
 * One-off cleanup for questions stored with literal HTML entities
 * (e.g. "Mbah&#x27;s administration" instead of "Mbah's administration") —
 * see questionService.js's decodeHtmlEntities for why this happened and how
 * new uploads are now protected. This decodes every already-affected row in
 * place. Safe to re-run — a row with nothing to decode is left untouched.
 *
 * Usage: node scripts/decodeQuestionHtmlEntities.js [--dry-run]
 */

const sequelize = require('../config/db');
const QuizQuestion = require('../models/QuizQuestion');
const { decodeHtmlEntities } = require('../services/questionService');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await sequelize.authenticate();
  console.log(`[Cleanup] DB connection OK${dryRun ? ' (dry run — no writes)' : ''}`);

  // Entity references always contain '&' followed eventually by ';' — cheap,
  // conservative prefilter so we only touch rows that could possibly need it.
  const candidates = await QuizQuestion.findAll({
    where: sequelize.literal(`question_text LIKE '%&%;%' OR options::text LIKE '%&%;%'`)
  });

  console.log(`[Cleanup] Found ${candidates.length} candidate rows (contain '&...;').`);

  let changed = 0;
  for (const q of candidates) {
    const newText = decodeHtmlEntities(q.questionText);
    const newOptions = {};
    let optionsChanged = false;
    for (const [key, value] of Object.entries(q.options || {})) {
      const decoded = typeof value === 'string' ? decodeHtmlEntities(value) : value;
      newOptions[key] = decoded;
      if (decoded !== value) optionsChanged = true;
    }

    const textChanged = newText !== q.questionText;
    if (!textChanged && !optionsChanged) continue;

    changed++;
    console.log(`\n[${q.id}]`);
    if (textChanged) console.log(`  text: "${q.questionText}"\n     -> "${newText}"`);
    if (optionsChanged) console.log(`  options: ${JSON.stringify(q.options)}\n        -> ${JSON.stringify(newOptions)}`);

    if (!dryRun) {
      await q.update({ questionText: newText, options: newOptions });
    }
  }

  console.log(`\n[Cleanup] ${changed} row(s) ${dryRun ? 'would be' : 'were'} updated out of ${candidates.length} candidates.`);
  await sequelize.close();
}

main().catch(err => {
  console.error('[Cleanup] Fatal error:', err);
  process.exit(1);
});
