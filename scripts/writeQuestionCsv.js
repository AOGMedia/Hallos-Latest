/**
 * Writes an array of { question, options: [a,b,c,d(,e)], correct, difficulty }
 * objects to a properly RFC4180-quoted CSV — every field wrapped in quotes,
 * with internal quotes doubled. Guards against the exact column-shift bug a
 * raw unquoted comma in question/option text caused earlier this session:
 * every field here goes through this, so no hand-written row can silently
 * misalign columns no matter how much punctuation it contains.
 */
// A field starting with =, +, -, or @ gets interpreted as a spreadsheet
// formula by xlsx's CSV parser (the same one questionService.uploadQuestions
// uses) rather than treated as literal text — discovered when three Excel-
// function options like "=SUM()" silently evaluated to empty, dropping the
// whole option column and failing validation with a confusing "missing
// required fields" error nowhere near the actual cause. Throwing here forces
// a manual reword (e.g. "SUM()" instead of "=SUM()") rather than silently
// mutating quiz content a player would actually see.
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@'];

function esc(value) {
  const str = String(value);
  if (FORMULA_TRIGGER_CHARS.includes(str[0])) {
    throw new Error(
      `Field starts with "${str[0]}", which a CSV/spreadsheet parser will treat as a formula and silently blank out: "${str.slice(0, 60)}". Reword to not start with =, +, -, or @.`
    );
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function writeQuestionsCsv(questions, outputPath) {
  const fs = require('fs');
  const header = ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Difficulty'];
  const lines = [header.map(esc).join(',')];

  for (const q of questions) {
    if (!q.question || !Array.isArray(q.options) || q.options.length < 4) {
      throw new Error(`Malformed question entry: ${JSON.stringify(q).slice(0, 120)}`);
    }
    if (!['a', 'b', 'c', 'd', 'e'].includes(q.correct.toLowerCase())) {
      throw new Error(`Invalid correct answer "${q.correct}" for question: ${q.question.slice(0, 60)}`);
    }
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) {
      throw new Error(`Invalid difficulty "${q.difficulty}" for question: ${q.question.slice(0, 60)}`);
    }
    const row = [q.question, ...q.options.slice(0, 4), q.correct.toUpperCase(), q.difficulty];
    lines.push(row.map(esc).join(','));
  }

  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${questions.length} questions to ${outputPath}`);
}

module.exports = { writeQuestionsCsv };
