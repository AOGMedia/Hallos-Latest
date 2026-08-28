const validator = require('validator');

/**
 * Quiz Input Sanitizer Middleware
 * 
 * Sanitizes all user inputs to prevent:
 * - XSS attacks
 * - SQL injection
 * - NoSQL injection
 * - Script injection
 */

class QuizInputSanitizer {
  /**
   * Sanitize string input
   * 
   * @param {string} input - Input string
   * @returns {string} Sanitized string
   */
  sanitizeString(input) {
    if (typeof input !== 'string') {
      return input;
    }

    // Trim whitespace
    let sanitized = input.trim();

    // Escape HTML to prevent XSS
    sanitized = validator.escape(sanitized);

    return sanitized;
  }

  /**
   * Sanitize number input
   * 
   * @param {any} input - Input value
   * @returns {number|null} Sanitized number or null
   */
  sanitizeNumber(input) {
    const num = Number(input);
    
    if (isNaN(num) || !isFinite(num)) {
      return null;
    }

    return num;
  }

  /**
   * Sanitize boolean input
   * 
   * @param {any} input - Input value
   * @returns {boolean} Sanitized boolean
   */
  sanitizeBoolean(input) {
    if (typeof input === 'boolean') {
      return input;
    }

    if (typeof input === 'string') {
      return input.toLowerCase() === 'true';
    }

    return Boolean(input);
  }

  /**
   * Sanitize object recursively
   * 
   * @param {Object} obj - Input object
   * @returns {Object} Sanitized object
   */
  sanitizeObject(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    if (typeof obj !== 'object') {
      if (typeof obj === 'string') {
        return this.sanitizeString(obj);
      }
      return obj;
    }

    // Fields that contain URLs — skip HTML escaping, only trim
    const URL_FIELDS = ['avatarUrl', 'url', 'imageUrl', 'thumbnailUrl', 'redirectUrl', 'callbackUrl', 'linkUrl', 'fileUrl'];

    const sanitized = {};

    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = this.sanitizeString(key);

      if (typeof value === 'string') {
        sanitized[sanitizedKey] = URL_FIELDS.includes(key)
          ? value.trim()
          : this.sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[sanitizedKey] = this.sanitizeObject(value);
      } else {
        sanitized[sanitizedKey] = value;
      }
    }

    return sanitized;
  }

  /**
   * Validate and sanitize email
   * 
   * @param {string} email - Email address
   * @returns {string|null} Sanitized email or null if invalid
   */
  sanitizeEmail(email) {
    if (!email || typeof email !== 'string') {
      return null;
    }

    const normalized = validator.normalizeEmail(email);
    
    if (!normalized || !validator.isEmail(normalized)) {
      return null;
    }

    return normalized;
  }

  /**
   * Validate and sanitize URL
   * 
   * @param {string} url - URL string
   * @returns {string|null} Sanitized URL or null if invalid
   */
  sanitizeURL(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    if (!validator.isURL(url, { protocols: ['http', 'https'], require_protocol: true })) {
      return null;
    }

    return url;
  }

  /**
   * Sanitize question upload data
   * 
   * @param {Object} questionData - Question data from Excel
   * @returns {Object} Sanitized question data
   */
  sanitizeQuestionData(questionData) {
    return {
      questionText: this.sanitizeString(questionData.questionText || ''),
      optionA: this.sanitizeString(questionData.optionA || ''),
      optionB: this.sanitizeString(questionData.optionB || ''),
      optionC: this.sanitizeString(questionData.optionC || ''),
      optionD: this.sanitizeString(questionData.optionD || ''),
      correctAnswer: this.sanitizeString(questionData.correctAnswer || '').toLowerCase(),
      difficulty: this.sanitizeString(questionData.difficulty || 'medium').toLowerCase(),
      category: this.sanitizeString(questionData.category || '')
    };
  }

  /**
   * Middleware to sanitize request body
   */
  sanitizeBody() {
    return (req, res, next) => {
      if (req.body) {
        req.body = this.sanitizeObject(req.body);
      }
      next();
    };
  }

  /**
   * Middleware to sanitize query parameters
   */
  sanitizeQuery() {
    return (req, res, next) => {
      if (req.query) {
        req.query = this.sanitizeObject(req.query);
      }
      next();
    };
  }

  /**
   * Middleware to sanitize URL parameters
   */
  sanitizeParams() {
    return (req, res, next) => {
      if (req.params) {
        req.params = this.sanitizeObject(req.params);
      }
      next();
    };
  }

  /**
   * Combined sanitization middleware
   * Sanitizes body, query, and params
   */
  sanitizeAll() {
    return (req, res, next) => {
      if (req.body) {
        req.body = this.sanitizeObject(req.body);
      }
      if (req.query) {
        const sanitized = this.sanitizeObject(req.query);
        Object.keys(req.query).forEach(key => delete req.query[key]);
        Object.assign(req.query, sanitized);
      }
      if (req.params) {
        req.params = this.sanitizeObject(req.params);
      }
      next();
    };
  }

  /**
   * Validate challenge creation input
   */
  validateChallengeInput(data) {
    const errors = [];

    if (!data.wagerAmount || typeof data.wagerAmount !== 'number' || data.wagerAmount < 0) {
      errors.push('Invalid wager amount');
    }

    if (data.categoryId && typeof data.categoryId !== 'string') {
      errors.push('Invalid category ID');
    }

    if (data.opponentId && typeof data.opponentId !== 'number') {
      errors.push('Invalid opponent ID');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate tournament creation input
   */
  validateTournamentInput(data) {
    const errors = [];

    if (!data.name || typeof data.name !== 'string' || data.name.length < 3) {
      errors.push('Tournament name must be at least 3 characters');
    }

    if (!data.format || !['speed_run', 'classic', 'knockout', 'battle_royale'].includes(data.format)) {
      errors.push('Invalid tournament format');
    }

    if (data.entryFee === undefined || typeof data.entryFee !== 'number' || data.entryFee < 0) {
      errors.push('Invalid entry fee');
    }

    if (!data.categoryId || typeof data.categoryId !== 'string') {
      errors.push('Invalid category ID');
    }

    if (!data.startTime || !validator.isISO8601(data.startTime)) {
      errors.push('Invalid start time');
    }

    if (!data.registrationDeadline || !validator.isISO8601(data.registrationDeadline)) {
      errors.push('Invalid registration deadline');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate answer submission input
   */
  validateAnswerInput(data) {
    const errors = [];

    if (!data.matchId || typeof data.matchId !== 'string') {
      errors.push('Invalid match ID');
    }

    if (!data.questionId || typeof data.questionId !== 'string') {
      errors.push('Invalid question ID');
    }

    // Accept both 'answer' and 'answerId' field names
    const answer = data.answer || data.answerId;
    if (!answer || !['a', 'b', 'c', 'd'].includes(String(answer).toLowerCase())) {
      errors.push('Invalid answer — must be a, b, c, or d');
    }

    // Accept both 'clientTimestamp' (ms) and 'timeInSeconds' (seconds)
    const hasTimestamp = data.clientTimestamp || data.timeInSeconds !== undefined;
    if (!hasTimestamp) {
      errors.push('Invalid client timestamp');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitize a free-text chat message.
   *
   * Deliberately does NOT use validator.escape(). Entity-encoding on input
   * corrupts ordinary punctuation for every downstream consumer ("it's" gets
   * stored as "it&#x27;s" and then renders literally), and HTML-escaping is an
   * output concern — the chat UI renders through React, which escapes text on
   * render by design.
   *
   * Defence on the way in is therefore removal rather than encoding: anything
   * shaped like a tag is stripped outright, so a <script> payload can't be
   * stored at all, while ordinary text survives untouched.
   */
  sanitizeChatMessage(input) {
    if (typeof input !== 'string') {
      return '';
    }

    // Strip anything shaped like a tag. Bare angle brackets are deliberately
    // left alone — they're common in ordinary messages ("2 < 4", "> quoted")
    // and can't form markup on their own; React escapes whatever reaches the
    // DOM, so it is the actual XSS boundary.
    let out = input.replace(/<[^>]*>/g, '');

    // Drop control characters, keeping tab (9) and newline (10). Done by
    // char code rather than a control-character regex to keep this file free
    // of literal control bytes.
    out = out
      .split('')
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code === 9 || code === 10 || (code >= 32 && code !== 127);
      })
      .join('');

    // Collapse runs of blank lines, then trim.
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Validate a chat message send
   */
  validateChatMessageInput(data) {
    const errors = [];

    const body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!body) {
      errors.push('Message body cannot be empty');
    } else if (body.length > 2000) {
      errors.push('Message body exceeds 2000 character limit');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

const quizInputSanitizer = new QuizInputSanitizer();

module.exports = quizInputSanitizer;
