const xlsx = require('xlsx');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const QuizQuestion = require('../models/QuizQuestion');
const QuizCategory = require('../models/QuizCategory');
const { uploadFileToS3 } = require('./s3Service');

/**
 * Question Service
 * 
 * Manages quiz question operations including:
 * - Excel file parsing and upload
 * - Question validation
 * - Duplicate detection
 * - Random selection with difficulty balancing
 * - Usage tracking
 */

class QuestionService {
  /**
   * Upload questions from Excel file
   * 
   * Expected Excel columns:
   * - Question (required)
   * - Option A (required)
   * - Option B (required)
   * - Option C (required)
   * - Option D (required)
   * - Correct Answer (required: 'a', 'b', 'c', or 'd')
   * - Difficulty (required: 'easy', 'medium', or 'hard')
   * 
   * @param {number} adminId - Admin user ID
   * @param {Buffer} fileBuffer - Excel file buffer
   * @param {string} categoryId - Category UUID
   * @param {string} originalFilename - Original filename
   * @returns {Promise<{success: boolean, questionsAdded: number, duplicatesSkipped: number, errors: Array, fileUrl?: string}>}
   */
  async uploadQuestions(adminId, fileBuffer, categoryId, originalFilename = 'questions.xlsx') {
    const results = {
      success: false,
      questionsAdded: 0,
      duplicatesSkipped: 0,
      errors: [],
      fileUrl: null
    };

    try {
      // Verify category exists
      const category = await QuizCategory.findByPk(categoryId);
      if (!category) {
        results.errors.push({ row: 0, error: 'Invalid category ID' });
        return results;
      }

      // Save Excel file to S3 for audit trail
      try {
        const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const s3Result = await uploadFileToS3(
          fileBuffer, 
          originalFilename, 
          contentType, 
          'quiz-questions'
        );
        results.fileUrl = s3Result.url;
        console.log(`[QuestionService] Excel file saved to S3: ${s3Result.url}`);
      } catch (s3Error) {
        console.error('[QuestionService] Failed to save Excel to S3:', s3Error.message);
        // Continue processing even if S3 upload fails
      }

      // Parse Excel file
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(worksheet);

      if (rows.length === 0) {
        results.errors.push({ row: 0, error: 'Excel file is empty' });
        return results;
      }

      // Process each row
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // Excel row number (accounting for header)
        const row = rows[i];

        try {
          // Validate row data
          const validation = this.validateQuestionRow(row, rowNum);
          if (!validation.valid) {
            results.errors.push({ row: rowNum, error: validation.error });
            continue;
          }

          const questionData = validation.data;

          // Check for duplicates
          const isDuplicate = await this.detectDuplicate(questionData.questionText, categoryId);
          if (isDuplicate) {
            results.duplicatesSkipped++;
            continue;
          }

          // Create question
          await QuizQuestion.create({
            categoryId,
            questionText: questionData.questionText,
            options: questionData.options,
            correctAnswer: questionData.correctAnswer,
            difficulty: questionData.difficulty,
            createdBy: adminId,
            isActive: true
          });

          results.questionsAdded++;
        } catch (error) {
          results.errors.push({ 
            row: rowNum, 
            error: error.message || 'Failed to create question' 
          });
        }
      }

      // Update category question count
      if (results.questionsAdded > 0) {
        await category.increment('questionCount', { by: results.questionsAdded });
      }

      results.success = results.questionsAdded > 0 || results.duplicatesSkipped > 0;
      return results;

    } catch (error) {
      results.errors.push({ row: 0, error: `File parsing error: ${error.message}` });
      return results;
    }
  }

  /**
   * Validate a single question row from Excel
   * 
   * @param {Object} row - Excel row data
   * @param {number} rowNum - Row number for error reporting
   * @returns {{valid: boolean, data?: Object, error?: string}}
   */
  validateQuestionRow(row, rowNum) {
    // Check required fields — accept both "Option A" and "OptionA" formats
    const getField = (row, ...keys) => {
      for (const key of keys) {
        if (row[key] !== undefined && String(row[key]).trim() !== '') return String(row[key]).trim();
      }
      return null;
    };

    // Accept both "Option A" / "OptionA" and bare letter "A" column headers
    const questionText = getField(row, 'Question');
    const optionA = getField(row, 'Option A', 'OptionA', 'A');
    const optionB = getField(row, 'Option B', 'OptionB', 'B');
    const optionC = getField(row, 'Option C', 'OptionC', 'C');
    const optionD = getField(row, 'Option D', 'OptionD', 'D');
    const optionE = getField(row, 'Option E', 'OptionE', 'E'); // optional — 5-option questions
    const rawAnswer = getField(row, 'Correct Answer', 'CorrectAnswer');
    // Difficulty is optional — defaults to 'medium' if column is absent
    const rawDifficulty = getField(row, 'Difficulty') || 'medium';

    const missing = [];
    if (!questionText) missing.push('Question');
    if (!optionA) missing.push('Option A / A');
    if (!optionB) missing.push('Option B / B');
    if (!optionC) missing.push('Option C / C');
    if (!optionD) missing.push('Option D / D');
    if (!rawAnswer) missing.push('Correct Answer');

    if (missing.length > 0) {
      return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
    }

    if (questionText.length < 10) {
      return { valid: false, error: 'Question text must be at least 10 characters' };
    }

    const options = { a: optionA, b: optionB, c: optionC, d: optionD };
    if (optionE) options.e = optionE;

    // Accept a/b/c/d/e, A/B/C/D/E, OptionA-E, "Option A"-"Option E"
    const answerMap = {
      'a': 'a', 'b': 'b', 'c': 'c', 'd': 'd', 'e': 'e',
      'optiona': 'a', 'optionb': 'b', 'optionc': 'c', 'optiond': 'd', 'optione': 'e',
      'option a': 'a', 'option b': 'b', 'option c': 'c', 'option d': 'd', 'option e': 'e'
    };
    const correctAnswer = answerMap[rawAnswer.toLowerCase()];
    if (!correctAnswer) {
      return { valid: false, error: `Correct Answer must be A/B/C/D/E or OptionA-E. Got: "${rawAnswer}"` };
    }

    // If correct answer is 'e', Option E must exist
    if (correctAnswer === 'e' && !optionE) {
      return { valid: false, error: 'Correct Answer is "E" but Option E / E column is missing or empty' };
    }

    const difficulty = rawDifficulty.toLowerCase();
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return { valid: false, error: 'Difficulty must be easy, medium, or hard' };
    }

    return { valid: true, data: { questionText, options, correctAnswer, difficulty } };
  }

  /**
   * Detect duplicate questions using text similarity
   * Uses PostgreSQL's pg_trgm extension for fuzzy matching
   * 
   * @param {string} questionText - Question text to check
   * @param {string} categoryId - Category UUID
   * @returns {Promise<boolean>} - True if duplicate found
   */
  async detectDuplicate(questionText, categoryId) {
    try {
      // Use pg_trgm similarity search
      // Similarity threshold: 0.7 (70% similar)
      const result = await sequelize.query(`
        SELECT id 
        FROM quiz_questions 
        WHERE category_id = :categoryId 
          AND similarity(question_text, :questionText) > 0.7
        LIMIT 1
      `, {
        replacements: { categoryId, questionText },
        type: sequelize.QueryTypes.SELECT
      });

      return result.length > 0;
    } catch (error) {
      // If pg_trgm is not available, fall back to exact match
      console.warn('pg_trgm similarity search failed, using exact match:', error.message);
      
      const existing = await QuizQuestion.findOne({
        where: {
          categoryId,
          questionText: {
            [Op.iLike]: questionText
          }
        }
      });

      return existing !== null;
    }
  }

  /**
   * Select balanced questions for a match/tournament
   * Distribution: 40% Easy, 40% Medium, 20% Hard
   * 
   * @param {string} categoryId - Category UUID
   * @param {number} count - Total number of questions (default: 10)
   * @returns {Promise<Array>} - Array of question objects
   */
  async selectBalancedQuestions(categoryId, count = 10) {
    const distribution = {
      easy: Math.floor(count * 0.4),    // 4 questions
      medium: Math.floor(count * 0.4),  // 4 questions
      hard: Math.ceil(count * 0.2)      // 2 questions
    };

    const questions = [];

    for (const [difficulty, needed] of Object.entries(distribution)) {
      const selected = await QuizQuestion.findAll({
        where: {
          categoryId,
          difficulty,
          isActive: true
        },
        order: sequelize.random(),
        limit: needed
      });

      if (selected.length < needed) {
        throw new Error(`Insufficient ${difficulty} questions in category. Need ${needed}, found ${selected.length}`);
      }

      questions.push(...selected);
    }

    // Shuffle the combined array
    return this.shuffleArray(questions);
  }

  /**
   * Get question by ID (without revealing correct answer)
   * 
   * @param {string} questionId - Question UUID
   * @param {boolean} includeAnswer - Include correct answer (for admin/validation)
   * @returns {Promise<Object>} - Question object
   */
  async getQuestionById(questionId, includeAnswer = false) {
    const attributes = includeAnswer 
      ? undefined 
      : { exclude: ['correctAnswer', 'createdBy'] };

    const question = await QuizQuestion.findByPk(questionId, { attributes });
    
    if (!question) {
      throw new Error('Question not found');
    }

    return question;
  }

  /**
   * Track question usage in a match
   * Increments the usageCount field
   * 
   * @param {string} questionId - Question UUID
   * @returns {Promise<void>}
   */
  async trackQuestionUsage(questionId) {
    await QuizQuestion.increment('usageCount', {
      where: { id: questionId }
    });
  }

  /**
   * Get questions by category with pagination
   * 
   * @param {string} categoryId - Category UUID
   * @param {Object} options - Query options (page, limit, difficulty)
   * @returns {Promise<{questions: Array, total: number}>}
   */
  async getQuestionsByCategory(categoryId, options = {}) {
    const { page = 1, limit = 20, difficulty } = options;
    const offset = (page - 1) * limit;

    const where = { categoryId, isActive: true };
    if (difficulty) {
      where.difficulty = difficulty;
    }

    const { count, rows } = await QuizQuestion.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      attributes: { exclude: ['correctAnswer'] }
    });

    return {
      questions: rows,
      total: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  /**
   * Update a question
   * 
   * @param {string} questionId - Question UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} - Updated question
   */
  async updateQuestion(questionId, updates) {
    const question = await QuizQuestion.findByPk(questionId);
    
    if (!question) {
      throw new Error('Question not found');
    }

    // Validate updates if they include certain fields
    if (updates.correctAnswer && !['a', 'b', 'c', 'd', 'e'].includes(updates.correctAnswer)) {
      throw new Error('Correct answer must be a, b, c, d, or e');
    }

    if (updates.difficulty && !['easy', 'medium', 'hard'].includes(updates.difficulty)) {
      throw new Error('Difficulty must be easy, medium, or hard');
    }

    await question.update(updates);
    return question;
  }

  /**
   * Delete (deactivate) a question
   * 
   * @param {string} questionId - Question UUID
   * @returns {Promise<void>}
   */
  async deleteQuestion(questionId) {
    const question = await QuizQuestion.findByPk(questionId);
    
    if (!question) {
      throw new Error('Question not found');
    }

    // Soft delete by setting isActive to false
    await question.update({ isActive: false });

    // Decrement category question count
    await QuizCategory.decrement('questionCount', {
      where: { id: question.categoryId }
    });
  }

  /**
   * Shuffle array using Fisher-Yates algorithm
   * 
   * @param {Array} array - Array to shuffle
   * @returns {Array} - Shuffled array
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}

module.exports = new QuestionService();
