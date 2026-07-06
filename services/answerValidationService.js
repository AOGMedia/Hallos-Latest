const QuizMatch = require('../models/QuizMatch');
const QuizQuestion = require('../models/QuizQuestion');

/**
 * Answer Validation Service
 * 
 * Server-side answer validation and anti-cheat measures:
 * - Validates all answers server-side
 * - Verifies timestamps within allowed time window
 * - Checks answer correctness
 * - Calculates adjusted response time with latency compensation
 */

class AnswerValidationService {
  constructor() {
    this.TIME_LIMIT = 10000; // 10 seconds per question
    this.LATENCY_BUFFER = 2000; // 2 second buffer for network latency
  }

  /**
   * Validate answer submission
   * 
   * @param {Object} submission - Answer submission data
   * @returns {Promise<{valid: boolean, correct?: boolean, responseTime?: number, reason?: string}>}
   */
  async validateAnswer(submission) {
    const { matchId, userId, questionId, answerId, clientTimestamp } = submission;

    try {
      // 1. Verify match exists and is active
      const match = await QuizMatch.findByPk(matchId);
      
      if (!match) {
        return { valid: false, reason: 'Match not found' };
      }

      if (match.status !== 'active') {
        return { valid: false, reason: 'Match is not active' };
      }

      // 2. Verify user is a participant
      const participant = match.participants.find(p => p.userId === userId);
      
      if (!participant) {
        return { valid: false, reason: 'User is not a participant in this match' };
      }

      // 3. Verify question belongs to match
      const questionIds = match.questions.map(q => q.toString());
      
      if (!questionIds.includes(questionId.toString())) {
        return { valid: false, reason: 'Invalid question for this match' };
      }

      // 4. Check if question was already answered
      const alreadyAnswered = participant.answers?.some(
        a => a.questionId?.toString() === questionId.toString()
      );

      if (alreadyAnswered) {
        return { valid: false, reason: 'Question already answered' };
      }

      // 5. Verify timestamp and check timing
      const serverTime = Date.now();
      const questionStartTime = match.questionStartTimes?.[questionId] || match.startedAt;
      
      if (!questionStartTime) {
        return { valid: false, reason: 'Question start time not found' };
      }

      const elapsed = serverTime - new Date(questionStartTime).getTime();
      const elapsedSeconds = elapsed / 1000;

      // Check if answer is within time limit + buffer
      if (elapsed > (this.TIME_LIMIT + this.LATENCY_BUFFER)) {
        return { 
          valid: false, 
          reason: 'timeout',
          elapsed: elapsedSeconds
        };
      }

      // 6. Verify answer correctness
      const question = await QuizQuestion.findByPk(questionId);
      
      if (!question) {
        return { valid: false, reason: 'Question not found' };
      }

      const isCorrect = question.correctAnswer === answerId;

      // 7. Calculate adjusted response time (compensate for latency)
      const latency = serverTime - clientTimestamp;
      const adjustedTime = Math.max(elapsed - latency, 0);

      // 8. Validate client timestamp is reasonable
      if (latency < 0 || latency > 5000) {
        // Client timestamp is in the future or latency > 5 seconds (suspicious)
        console.warn(`[AnswerValidation] Suspicious timestamp for user ${userId}: latency=${latency}ms`);
        
        // Still accept but flag for review
        return {
          valid: true,
          correct: isCorrect,
          responseTime: adjustedTime,
          latency,
          flagged: true,
          flagReason: 'suspicious_timestamp'
        };
      }

      return {
        valid: true,
        correct: isCorrect,
        responseTime: adjustedTime,
        latency,
        serverTime,
        clientTimestamp
      };

    } catch (error) {
      console.error('[AnswerValidation] Validation error:', error);
      return { 
        valid: false, 
        reason: 'validation_error',
        error: error.message 
      };
    }
  }

  /**
   * Validate tournament answer submission
   * 
   * @param {Object} submission - Tournament answer submission
   * @returns {Promise<{valid: boolean, correct?: boolean, responseTime?: number, reason?: string}>}
   */
  async validateTournamentAnswer(submission) {
    const { tournamentId, roundNumber, userId, questionId, answerId, clientTimestamp } = submission;

    try {
      const QuizTournamentRound = require('../models/QuizTournamentRound');
      
      // 1. Verify round exists
      const round = await QuizTournamentRound.findOne({
        where: { tournamentId, roundNumber }
      });

      if (!round) {
        return { valid: false, reason: 'Round not found' };
      }

      if (round.status !== 'active') {
        return { valid: false, reason: 'Round is not active' };
      }

      // 2. Verify user is a participant in this round
      const participant = round.participants.find(p => p.userId === userId);
      
      if (!participant) {
        return { valid: false, reason: 'User is not a participant in this round' };
      }

      // 3. Verify question belongs to round
      const questionIds = round.questions.map(q => q.toString());
      
      if (!questionIds.includes(questionId.toString())) {
        return { valid: false, reason: 'Invalid question for this round' };
      }

      // 4. Check timing
      const serverTime = Date.now();
      const roundStartTime = new Date(round.startedAt).getTime();
      const elapsed = serverTime - roundStartTime;

      // Tournament questions have same time limit
      if (elapsed > (this.TIME_LIMIT + this.LATENCY_BUFFER)) {
        return { 
          valid: false, 
          reason: 'timeout',
          elapsed: elapsed / 1000
        };
      }

      // 5. Verify answer correctness
      const question = await QuizQuestion.findByPk(questionId);
      
      if (!question) {
        return { valid: false, reason: 'Question not found' };
      }

      const isCorrect = question.correctAnswer === answerId;

      // 6. Calculate adjusted response time
      const latency = serverTime - clientTimestamp;
      const adjustedTime = Math.max(elapsed - latency, 0);

      return {
        valid: true,
        correct: isCorrect,
        responseTime: adjustedTime,
        latency
      };

    } catch (error) {
      console.error('[AnswerValidation] Tournament validation error:', error);
      return { 
        valid: false, 
        reason: 'validation_error',
        error: error.message 
      };
    }
  }

  /**
   * Batch validate multiple answers
   * 
   * @param {Array} submissions - Array of answer submissions
   * @returns {Promise<Array>} Array of validation results
   */
  async batchValidate(submissions) {
    const results = [];

    for (const submission of submissions) {
      const result = await this.validateAnswer(submission);
      results.push({
        ...submission,
        validation: result
      });
    }

    return results;
  }

  /**
   * Check if timestamp is suspicious
   * 
   * @param {number} clientTimestamp - Client timestamp
   * @param {number} serverTime - Server timestamp
   * @returns {boolean} True if suspicious
   */
  isSuspiciousTimestamp(clientTimestamp, serverTime) {
    const latency = serverTime - clientTimestamp;
    
    // Suspicious if:
    // - Client timestamp is in the future
    // - Latency is negative (impossible)
    // - Latency is > 5 seconds (very high)
    return latency < 0 || latency > 5000;
  }

  /**
   * Get validation statistics
   * 
   * @param {string} matchId - Match ID
   * @returns {Promise<Object>} Validation statistics
   */
  async getValidationStats(matchId) {
    const QuizMatchAnswer = require('../models/QuizMatchAnswer');
    
    const answers = await QuizMatchAnswer.findAll({
      where: { matchId }
    });

    const stats = {
      totalAnswers: answers.length,
      correctAnswers: answers.filter(a => a.isCorrect).length,
      averageResponseTime: 0,
      averageLatency: 0,
      flaggedAnswers: 0
    };

    if (answers.length > 0) {
      stats.averageResponseTime = answers.reduce((sum, a) => sum + a.responseTime, 0) / answers.length;
      stats.averageLatency = answers.reduce((sum, a) => sum + (a.latency || 0), 0) / answers.length;
    }

    return stats;
  }
}

module.exports = new AnswerValidationService();
