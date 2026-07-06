const sequelize = require('../config/db');
const { Op } = require('sequelize');
const QuizMatch = require('../models/QuizMatch');
const QuizMatchAnswer = require('../models/QuizMatchAnswer');
const UserQuizStats = require('../models/UserQuizStats');
const questionService = require('./questionService');
const quizWalletService = require('./quizWalletService');
const answerValidationService = require('./answerValidationService');
const suspiciousActivityService = require('./suspiciousActivityService');

/**
 * Lobby Service
 * 
 * Manages 1v1 challenge creation, wager negotiation, and match execution
 * 
 * Match Flow:
 * 1. User creates challenge with wager amount
 * 2. Funds are escrowed from challenger
 * 3. Opponent can accept, decline, or counter-offer
 * 4. On acceptance, opponent funds are escrowed and match starts
 * 5. Both players answer 10 questions
 * 6. Winner determined by score (then time)
 * 7. Escrowed funds released to winner
 */

class LobbyService {
  /**
   * Calculate points for a correct answer based on difficulty and response time
   * @param {string} difficulty - 'easy' | 'medium' | 'hard'
   * @param {number} responseTime - time in seconds
   * @returns {number} points earned
   */
  calculatePoints(difficulty, responseTime) {
    const basePoints = { easy: 5, medium: 8, hard: 12 };
    const base = basePoints[difficulty?.toLowerCase()] || 5;
    const speedBonus = responseTime <= 5 ? 3 : 0;
    return base + speedBonus;
  }

  /**
   * Create a new challenge
   * 
   * @param {number} userId - Challenger user ID
   * @param {number} wagerAmount - Wager in Chuta
   * @param {string} categoryId - Question category UUID
   * @param {number} opponentId - Specific opponent ID (optional)
   * @returns {Promise<{success: boolean, challengeId: string, status: string, escrowAmount: number}>}
   */
  /**
   * Emit a socket event to a specific user if they are connected
   */
  _emitToUser(userId, event, payload) {
    try {
      const websocketManager = require('./websocketManager');
      const socket = websocketManager.getUserSocket(Number(userId));
      if (socket) {
        socket.emit(event, payload);
        console.log(`[LobbyService] Emitted '${event}' to user ${userId}`);
      } else {
        console.warn(`[LobbyService] User ${userId} not connected, could not emit '${event}'`);
      }
    } catch (e) {
      console.error(`[LobbyService] Failed to emit '${event}' to user ${userId}:`, e.message);
    }
  }

  async createChallenge(userId, wagerAmount, categoryId, opponentId = null) {
    // Validate wager amount
    if (wagerAmount < 0) {
      throw new Error('Wager amount must be non-negative');
    }

    // Validate categoryId
    if (!categoryId) {
      throw new Error('categoryId is required. Call GET /api/quiz/categories to get valid category IDs.');
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(categoryId)) {
      throw new Error('categoryId must be a valid UUID. Call GET /api/quiz/categories to get valid category IDs.');
    }

    // Verify user balance
    const balanceCheck = await quizWalletService.verifyBalance(userId, wagerAmount);
    if (!balanceCheck.sufficient) {
      throw new Error(`Insufficient balance. You have ${balanceCheck.currentBalance} Chuta, need ${wagerAmount} Chuta`);
    }

    // Escrow the wager amount
    const escrowResult = await quizWalletService.escrowFunds(userId, wagerAmount, 'pending');

    // Create match record
    const match = await QuizMatch.create({
      matchType: 'lobby',
      categoryId,
      participants: [
        {
          userId,
          wagerAmount,
          status: 'active',
          score: 0,
          completionTime: null,
          answers: []
        }
      ],
      questions: [],
      questionStartTimes: {},
      status: 'pending',
      escrowAmount: wagerAmount,
      challengerId: userId,
      opponentId: opponentId,
      expiresAt: new Date(Date.now() + 60 * 1000) // 60 seconds timeout
    });

    // Update match ID in escrow metadata
    await sequelize.query(
      `UPDATE chuta_coin_transactions 
       SET metadata = jsonb_set(metadata, '{matchId}', :matchId::jsonb)
       WHERE id = (
         SELECT id FROM chuta_coin_transactions
         WHERE user_id = :userId 
           AND type = 'match_wager' 
           AND metadata->>'matchId' = 'pending'
         ORDER BY created_at DESC 
         LIMIT 1
       )`,
      {
        replacements: { matchId: `"${match.id}"`, userId },
        type: sequelize.QueryTypes.UPDATE
      }
    );

    // If targeting a specific opponent, notify them via socket
    if (opponentId) {
      const UserQuizStats = require('../models/UserQuizStats');
      const QuizCategory = require('../models/QuizCategory');
      const [challengerStats, category] = await Promise.all([
        UserQuizStats.findOne({ where: { userId }, attributes: ['userId', 'nickname', 'avatarUrl', 'lobbyStats'] }),
        match.categoryId ? QuizCategory.findByPk(match.categoryId, { attributes: ['name'] }) : null
      ]);
      this._emitToUser(opponentId, 'challenge_received', {
        challengeId: match.id,
        challenger: {
          userId,
          nickname: challengerStats?.nickname || `Player_${userId}`,
          avatarUrl: challengerStats?.avatarUrl || null,
          chutaBalance: 0
        },
        categoryName: category?.name || 'Unknown',
        wagerAmount,
        expiresAt: match.expiresAt
      });
    }

    return {
      success: true,
      challengeId: match.id,
      status: match.status,
      escrowAmount: wagerAmount
    };
  }

  /**
   * Accept a challenge
   * 
   * @param {string} challengeId - Match UUID
   * @param {number} userId - Accepting user ID
   * @returns {Promise<{success: boolean, matchId: string, startTime: Date, questions: Array}>}
   */
  async acceptChallenge(challengeId, userId) {
    const match = await QuizMatch.findByPk(challengeId);

    if (!match) {
      throw new Error('Challenge not found');
    }

    if (match.status !== 'pending') {
      throw new Error('Challenge is no longer available');
    }

    // Check if challenge has expired
    if (new Date() > new Date(match.expiresAt)) {
      await this.expireChallenge(challengeId);
      throw new Error('Challenge has expired');
    }

    const challenger = match.participants[0];

    // Verify not accepting own challenge
    if (challenger.userId === userId) {
      throw new Error('Cannot accept your own challenge');
    }

    // If challenge is for specific opponent, verify
    if (match.opponentId && match.opponentId !== userId) {
      throw new Error('This challenge is for a specific opponent');
    }

    // Guard against broken challenges with no category
    if (!match.categoryId) {
      await match.update({ status: 'cancelled' });
      throw new Error('This challenge is invalid (no category assigned) and has been cancelled. Please create a new challenge.');
    }

    // Verify user balance
    const wagerAmount = challenger.wagerAmount;
    const balanceCheck = await quizWalletService.verifyBalance(userId, wagerAmount);
    if (!balanceCheck.sufficient) {
      throw new Error(`Insufficient balance. You have ${balanceCheck.currentBalance} Chuta, need ${wagerAmount} Chuta`);
    }

    // Escrow opponent's wager
    await quizWalletService.escrowFunds(userId, wagerAmount, match.id);

    // Safety parse participants in case Postgres returned it as a string
    const existingParticipants = Array.isArray(match.participants)
      ? match.participants
      : JSON.parse(match.participants || '[]');

    // Add opponent to participants — clean serialize to avoid JSONB issues
    const participants = JSON.parse(JSON.stringify([
      ...existingParticipants,
      {
        userId,
        wagerAmount,
        status: 'active',
        score: 0,
        completionTime: null,
        answers: []
      }
    ]));

    // Select questions for the match
    const questions = await questionService.selectBalancedQuestions(match.categoryId, 10);
    const questionIds = questions.map(q => q.id);

    // Initialize question start times — clean serialize to avoid JSONB issues
    const questionStartTimesRaw = {};
    questionIds.forEach(qId => { questionStartTimesRaw[qId] = null; });
    const questionStartTimes = JSON.parse(JSON.stringify(questionStartTimesRaw));

    // Update match
    await match.update({
      participants,
      questions: questionIds,
      questionStartTimes,
      status: 'active',
      escrowAmount: wagerAmount * 2,
      startedAt: new Date()
    });

    // Track question usage
    for (const question of questions) {
      await questionService.trackQuestionUsage(question.id);
    }

    // Return questions without correct answers
    const questionsForClient = questions.map(q => ({
      id: q.id,
      questionText: q.questionText,
      options: q.options,
      difficulty: q.difficulty
    }));

    // Fetch challenger's quiz profile for the opponent to display
    const UserQuizStats = require('../models/UserQuizStats');
    const challengerStats = await UserQuizStats.findOne({
      where: { userId: match.challengerId },
      attributes: ['userId', 'nickname', 'avatarUrl']
    });

    // Fetch acceptor's quiz profile for the challenger to display
    const acceptorStats = await UserQuizStats.findOne({
      where: { userId },
      attributes: ['userId', 'nickname', 'avatarUrl']
    });

    // Emit challenge_accepted to the challenger's socket so they navigate to /game
    // Uses sendOrQueue so it's delivered even if challenger briefly disconnected
    try {
      const websocketManager = require('./websocketManager');
      websocketManager.sendOrQueue(match.challengerId, 'challenge_accepted', {
        challengeId: match.id,
        matchId: match.id,
        startTime: match.startedAt || new Date(),
        questions: questionsForClient,
        opponent: {
          userId,
          nickname: acceptorStats?.nickname || `Player_${userId}`,
          avatarUrl: acceptorStats?.avatarUrl || null
        }
      });
    } catch (wsError) {
      console.error('[LobbyService] Failed to queue challenge_accepted:', wsError.message);
    }

    return {
      success: true,
      matchId: match.id,
      challengeId: match.id,
      startTime: match.startedAt || new Date(),
      questions: questionsForClient,
      challenger: {
        userId: match.challengerId,
        nickname: challengerStats?.nickname || `Player_${match.challengerId}`,
        avatarUrl: challengerStats?.avatarUrl || null
      }
    };
  }

  /**
   * Decline a challenge
   * 
   * @param {string} challengeId - Match UUID
   * @param {number} userId - Declining user ID
   * @returns {Promise<{success: boolean, refundAmount: number}>}
   */
  async declineChallenge(challengeId, userId) {
    const match = await QuizMatch.findByPk(challengeId);

    if (!match) {
      throw new Error('Challenge not found');
    }

    if (match.status !== 'pending') {
      throw new Error('Challenge cannot be declined');
    }

    const challenger = match.participants[0];

    // Verify user is the intended opponent
    if (match.opponentId && match.opponentId !== userId) {
      throw new Error('You are not the intended opponent');
    }

    // Refund challenger's escrow
    await quizWalletService.refundEscrow(match.id, [
      { userId: challenger.userId, amount: challenger.wagerAmount }
    ]);

    // Update match status
    await match.update({
      status: 'cancelled',
      completedAt: new Date()
    });

    // Notify challenger their challenge was declined
    this._emitToUser(challenger.userId, 'challenge_declined', {
      challengeId: match.id,
      refundAmount: challenger.wagerAmount
    });

    return {
      success: true,
      refundAmount: challenger.wagerAmount
    };
  }

  /**
   * Cancel a challenge (by the challenger themselves)
   * 
   * @param {string} challengeId - Match UUID
   * @param {number} userId - Cancelling user ID
   * @returns {Promise<{success: boolean, refundAmount: number}>}
   */
  async cancelChallenge(challengeId, userId) {
    const match = await QuizMatch.findByPk(challengeId);

    if (!match) {
      throw new Error('Challenge not found');
    }

    if (match.status !== 'pending') {
      throw new Error('Challenge cannot be cancelled');
    }

    // Verify user is the challenger
    if (match.challengerId !== userId) {
      throw new Error('Only the creator can cancel this challenge');
    }

    const participant = match.participants[0];

    // Refund challenger's escrow
    await quizWalletService.refundEscrow(match.id, [
      { userId: participant.userId, amount: participant.wagerAmount }
    ]);

    // Update match status
    await match.update({
      status: 'cancelled',
      completedAt: new Date()
    });

    // Notify opponent if it was a direct challenge
    if (match.opponentId) {
      this._emitToUser(match.opponentId, 'challenge_cancelled', {
        challengeId: match.id,
        challengerId: userId
      });
    }

    return {
      success: true,
      refundAmount: participant.wagerAmount
    };
  }

  /**
   * Counter-offer with new wager amount
   * 
   * @param {string} challengeId - Match UUID
   * @param {number} userId - Counter-offering user ID
   * @param {number} newWagerAmount - New wager in Chuta
   * @returns {Promise<{success: boolean, counterOfferId: string}>}
   */
  async counterOffer(challengeId, userId, newWagerAmount) {
    const originalMatch = await QuizMatch.findByPk(challengeId);

    if (!originalMatch) {
      throw new Error('Challenge not found');
    }

    if (originalMatch.status !== 'pending') {
      throw new Error('Challenge is no longer available');
    }

    const challenger = originalMatch.participants[0];

    // Verify not counter-offering own challenge
    if (challenger.userId === userId) {
      throw new Error('Cannot counter-offer your own challenge');
    }

    // Verify user balance for new wager
    const balanceCheck = await quizWalletService.verifyBalance(userId, newWagerAmount);
    if (!balanceCheck.sufficient) {
      throw new Error(`Insufficient balance for counter-offer. You have ${balanceCheck.currentBalance} Chuta, need ${newWagerAmount} Chuta`);
    }

    // Create new challenge with counter-offer
    const counterMatch = await this.createChallenge(
      userId,
      newWagerAmount,
      originalMatch.categoryId,
      challenger.userId // Specific to original challenger
    );

    // Mark original challenge as countered (cancelled and replaced by counter-offer)
    await originalMatch.update({
      status: 'cancelled',
      counterOfferId: counterMatch.challengeId
    });

    // Notify original challenger about the counter-offer
    const UserQuizStats = require('../models/UserQuizStats');
    const counterStats = await UserQuizStats.findOne({ where: { userId }, attributes: ['nickname'] });
    this._emitToUser(challenger.userId, 'challenge_counter', {
      challengeId: counterMatch.challengeId,
      newWagerAmount,
      opponentNickname: counterStats?.nickname || `Player_${userId}`
    });

    return {
      success: true,
      counterOfferId: counterMatch.challengeId,
      newWagerAmount
    };
  }

  /**
   * Submit an answer during a match
   * 
   * @param {string} matchId - Match UUID
   * @param {number} userId - User ID
   * @param {string} questionId - Question UUID
   * @param {string} answerId - Selected answer ('a', 'b', 'c', or 'd')
   * @param {number} clientTimestamp - Client timestamp when answer was submitted
   * @returns {Promise<{success: boolean, correct: boolean, responseTime: number}>}
   */
  async submitAnswer(matchId, userId, questionId, answerId, clientTimestamp) {
    return await QuizMatch.sequelize.transaction(async (t) => {
      // 1. Fetch match with row-level lock to prevent concurrent JSONB overwrites
      const match = await QuizMatch.findByPk(matchId, { lock: t.LOCK.UPDATE, transaction: t });

      if (!match) {
        throw new Error('Match not found');
      }

      if (match.status !== 'active') {
        throw new Error('Match is not active');
      }

      // Verify question belongs to match
      if (!match.questions.includes(questionId)) {
        throw new Error('Invalid question for this match');
      }

      // Verify user is a participant
      const participant = match.participants.find(p => p.userId === userId);
      if (!participant) {
        throw new Error('User is not a participant in this match');
      }

      // Check if already answered this question
      const QuizMatchAnswer = require('../models/QuizMatchAnswer');
      const existingAnswer = await QuizMatchAnswer.findOne({
        where: { matchId, userId, questionId },
        transaction: t
      });

      if (existingAnswer) {
        throw new Error('Question already answered');
      }

      // Get question to check correct answer
      const questionService = require('./questionService');
      const question = await questionService.getQuestionById(questionId, true);

      // Validate timing (10s limit + 2s latency buffer)
      const serverTime = Date.now();
      const questionStartTime = match.questionStartTimes[questionId];
      
      if (!questionStartTime) {
        // First time this question is being answered, set start time
        match.questionStartTimes[questionId] = serverTime;
        match.changed('questionStartTimes', true); // Force Sequelize JSONB
        await match.save({ transaction: t });
      }

      const elapsed = (serverTime - (questionStartTime || serverTime)) / 1000;
      
      if (elapsed > 12 && answerId.toLowerCase() !== 'timeout') {
         // Even if timeout, we must record the answer as timeout so the game can end
         // If elapsed > 12 but answerId != 'timeout', it's a late submission
         // The client automatically sends 'timeout' after 12 seconds anyway
         console.warn(`[submitAnswer] Late answer from ${userId} for ${questionId}. Treating as incorrect.`);
         answerId = 'timeout'; // Force incorrect
      }

      // Calculate latency and adjusted response time
      const clientTimeInt = Math.floor(Number(clientTimestamp));
      const latency = serverTime - clientTimeInt;
      const adjustedTime = Math.max(elapsed - (latency / 1000), 0);

      // Check if answer is correct
      const isCorrect = (answerId.toLowerCase() !== 'timeout') && (question.correctAnswer === answerId.toLowerCase());
      console.log(`[submitAnswer] correctAnswer: "${question.correctAnswer}" | answerId: "${answerId.toLowerCase()}" | isCorrect: ${isCorrect}`);

      // Calculate points earned (dynamic scoring)
      const pointsEarned = isCorrect ? this.calculatePoints(question.difficulty, adjustedTime) : 0;

      // Record answer
      const answer = await QuizMatchAnswer.create({
        matchId,
        userId,
        questionId,
        selectedAnswer: answerId.toLowerCase(),
        isCorrect,
        responseTime: adjustedTime,
        clientTimestamp: clientTimeInt || serverTime,
        serverTimestamp: serverTime,
        latency: Math.floor(latency)
      }, { transaction: t });

      // Update participant's answers array and score with actual points
      participant.answers.push(answer.id);
      participant.score = (participant.score || 0) + pointsEarned;
      match.changed('participants', true); // Force Sequelize to detect JSONB mutation
      await match.save({ transaction: t });

      // Check if match should end inside transaction context
      const allAnswered = match.participants.every(
        p => p.answers.length === match.questions.length
      );

      // Defer side-effects (socket emissions and endMatch) until after transaction commits
      setTimeout(async () => {
        try {
          const websocketManager = require('./websocketManager');
          if (websocketManager.io) {
            const progressPayload = {
              userId,
              questionId,
              score: participant.score,       // cumulative points (not count)
              pointsEarned,                   // points from this answer
              answersCount: participant.answers.length,
              totalQuestions: match.questions.length
            };

            // Emit to match room
            websocketManager.io.to(`match:${matchId}`).emit('opponent_progress', progressPayload);

            // Also emit directly to opponent's socket as fallback
            const freshParticipants = match.participants;
            for (const p of freshParticipants) {
              if (p.userId !== userId) {
                websocketManager.sendOrQueue(p.userId, 'opponent_progress', progressPayload);
              }
            }
          }

          if (allAnswered) {
            await this.endMatch(matchId);
          }
        } catch (e) {
          console.error('[LobbyService] Post-transaction side effect failed:', e.message);
        }
      }, 0);

      return {
        success: true,
        correct: isCorrect,
        correctAnswer: question.correctAnswer,
        pointsEarned,
        responseTime: adjustedTime
      };
    });
  }

  /**
   * End a match and determine winner
   * 
   * @param {string} matchId - Match UUID
   * @returns {Promise<{success: boolean, winnerId: number, scores: Object, earnings: Object}>}
   */
  async endMatch(matchId) {
    return await QuizMatch.sequelize.transaction(async (t) => {
      // Use LOCK.UPDATE to serialize concurrent incoming requests to end the match
      const match = await QuizMatch.findByPk(matchId, { lock: t.LOCK.UPDATE, transaction: t });

      if (!match) {
        throw new Error('Match not found');
      }

      // Idempotency: If already completed, just return quietly
      if (match.status === 'completed') {
        return { success: true, winnerId: match.winnerId, alreadyCompleted: true };
      }

      if (match.status !== 'active') {
        throw new Error('Match is not active');
      }

      // Calculate completion times for each participant
      for (const participant of match.participants) {
        const answers = await QuizMatchAnswer.findAll({
          where: {
            matchId,
            userId: participant.userId
          },
          order: [['createdAt', 'ASC']],
          transaction: t
        });

        if (answers.length > 0) {
          const firstAnswer = answers[0];
          const lastAnswer = answers[answers.length - 1];
          participant.completionTime = new Date(lastAnswer.createdAt) - new Date(firstAnswer.createdAt);
        } else {
          participant.completionTime = Infinity;
        }
      }

      // Determine winner (highest score, then fastest time)
      const [p1, p2] = match.participants;
      let winnerId;

      if (p1.score > p2.score) {
        winnerId = p1.userId;
      } else if (p2.score > p1.score) {
        winnerId = p2.userId;
      } else {
        // Tie on score, use completion time
        const p1Time = p1.completionTime === Infinity ? Infinity : (p1.completionTime || 0);
        const p2Time = p2.completionTime === Infinity ? Infinity : (p2.completionTime || 0);
        winnerId = p1Time <= p2Time ? p1.userId : p2.userId;
      }

      // Release escrowed funds to winner safely
      try {
        await quizWalletService.releaseEscrow(matchId, winnerId, match.escrowAmount);
      } catch (escrowError) {
        console.error('[LobbyService] Failed to release escrow in endMatch:', escrowError.message);
      }

      // Update match
      match.changed('participants', true);
      await match.update({
        winnerId,
        status: 'completed',
        completedAt: new Date()
      }, { transaction: t });

      // Update user stats
      try {
        await this.updateUserStats(match);
      } catch (statsError) {
        console.error('[LobbyService] Failed to update user stats in endMatch:', statsError.message);
      }

      const scores = {};
      const earnings = {};
      
      match.participants.forEach(p => {
        scores[p.userId] = {
          correct: p.score,
          totalTime: p.completionTime === Infinity ? 0 : p.completionTime,
          score: p.score
        };
        earnings[p.userId] = p.userId === winnerId ? match.escrowAmount : 0;
      });

      // Emit match_ended to both players
      try {
        const websocketManager = require('./websocketManager');
        if (websocketManager.io) {
          const participant1 = match.participants.find(p => p.userId === match.challengerId) || match.participants[0];
          const participant2 = match.participants.find(p => p.userId !== match.challengerId) || match.participants[1];
          
          const payload = {
            winnerId,
            player1Score: participant1?.score ?? 0,
            player2Score: participant2?.score ?? 0,
            player1UserId: participant1?.userId,
            player2UserId: participant2?.userId,
            scores,
            earnings,
            totalTime: Math.max(
              participant1?.completionTime === Infinity ? 0 : (participant1?.completionTime || 0),
              participant2?.completionTime === Infinity ? 0 : (participant2?.completionTime || 0)
            ),
            reason: 'completed'
          };

          websocketManager.io.to(`match:${matchId}`).emit('match_ended', payload);
          
          // Also send via sendOrQueue for robust delivery to disconnected players returning to game
          websocketManager.sendOrQueue(participant1.userId, 'match_ended', payload);
          if (participant2?.userId) {
            websocketManager.sendOrQueue(participant2.userId, 'match_ended', payload);
          }
        }
      } catch (wsError) {
        console.error('[LobbyService] Failed to emit match_ended:', wsError.message);
      }

      return {
        success: true,
        winnerId,
        scores,
        earnings
      };
    });
  }

  /**
   * Forfeit a match
   * 
   * @param {string} matchId - Match UUID
   * @param {number} userId - Forfeiting user ID
   * @returns {Promise<{success: boolean, penaltyAmount: number, winnerId: number}>}
   */
  async forfeitMatch(matchId, userId) {
    const match = await QuizMatch.findByPk(matchId);

    if (!match) {
      throw new Error('Match not found');
    }

    if (match.status !== 'active') {
      throw new Error('Match is not active');
    }

    // Find forfeiting participant
    const forfeitingParticipant = match.participants.find(p => p.userId === userId);
    if (!forfeitingParticipant) {
      throw new Error('User is not a participant');
    }

    // Mark as forfeited
    forfeitingParticipant.status = 'forfeited';

    // Determine winner (the other participant)
    const winnerId = match.participants.find(p => p.userId !== userId).userId;

    // Release all escrowed funds to winner
    await quizWalletService.releaseEscrow(matchId, winnerId, match.escrowAmount);

    // Update match
    match.changed('participants', true); // Force Sequelize to detect JSONB mutation
    await match.update({
      winnerId,
      status: 'completed',
      completedAt: new Date()
    });

    // Update user stats
    await this.updateUserStats(match);

    // Emit match_ended to both players in the match room
    try {
      const websocketManager = require('./websocketManager');
      if (websocketManager.io) {
        const p1 = match.participants.find(p => p.userId === match.challengerId) || match.participants[0];
        const p2 = match.participants.find(p => p.userId !== match.challengerId) || match.participants[1];
        websocketManager.io.to(`match:${matchId}`).emit('match_ended', {
          winnerId,
          player1Score: p1?.score ?? 0,
          player2Score: p2?.score ?? 0,
          player1UserId: p1?.userId,
          player2UserId: p2?.userId,
          totalTime: 0,
          reason: 'forfeit'
        });
      }
    } catch (wsError) {
      console.error('[LobbyService] Failed to emit match_ended on forfeit:', wsError.message);
    }

    return {
      success: true,
      penaltyAmount: forfeitingParticipant.wagerAmount,
      winnerId
    };
  }

  /**
   * Expire a challenge (24 hours passed)
   * 
   * @param {string} challengeId - Match UUID
   * @returns {Promise<void>}
   */
  async expireChallenge(challengeId) {
    const match = await QuizMatch.findByPk(challengeId);

    if (!match || match.status !== 'pending') {
      return;
    }

    const challenger = match.participants[0];

    // Refund challenger's escrow
    await quizWalletService.refundEscrow(match.id, [
      { userId: challenger.userId, amount: challenger.wagerAmount }
    ]);

    // Update match status
    await match.update({
      status: 'expired',
      completedAt: new Date()
    });

    // Notify challenger their challenge timed out
    this._emitToUser(challenger.userId, 'challenge_timeout', {
      challengeId: match.id
    });
  }

  /**
   * Get available challenges
   * 
   * @param {Object} options - Query options (status, page, limit)
   * @returns {Promise<{challenges: Array, totalCount: number}>}
   */
  async getChallenges(options = {}) {
    const { status = 'pending', page = 1, limit = 20, excludeUserId = null } = options;
    const offset = (page - 1) * limit;

    const where = {
      matchType: 'lobby',
      status
    };

    if (status === 'pending') {
      where.expiresAt = { [Op.gt]: new Date() };
    }

    // Exclude the requesting user's own challenges AND filter by opponent
    if (excludeUserId) {
      where.challengerId = { [Op.ne]: excludeUserId };
      
      // Board should only show:
      // 1. Public challenges (opponentId is null)
      // 2. Private challenges directed specifically to this user
      where[Op.or] = [
        { opponentId: null },
        { opponentId: excludeUserId }
      ];
    }

    const { count, rows } = await QuizMatch.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    // Enrich with challenger nickname, avatar, and category name
    const UserQuizStats = require('../models/UserQuizStats');
    const QuizCategory = require('../models/QuizCategory');

    // Collect unique challenger IDs and category IDs
    const challengerIds = [...new Set(rows.map(r => r.challengerId).filter(Boolean))];
    const categoryIds = [...new Set(rows.map(r => r.categoryId).filter(Boolean))];

    const [statsRows, categories] = await Promise.all([
      challengerIds.length ? UserQuizStats.findAll({
        where: { userId: { [Op.in]: challengerIds } },
        attributes: ['userId', 'nickname', 'avatarUrl', 'lobbyStats']
      }) : [],
      categoryIds.length ? QuizCategory.findAll({
        where: { id: { [Op.in]: categoryIds } },
        attributes: ['id', 'name']
      }) : []
    ]);

    const statsMap = {};
    statsRows.forEach(s => { statsMap[s.userId] = s; });

    const categoryMap = {};
    categories.forEach(c => { categoryMap[c.id] = c.name; });

    const challenges = rows.map(match => {
      const challenger = statsMap[match.challengerId];
      const wagerAmount = match.participants?.[0]?.wagerAmount ?? match.escrowAmount ?? 0;

      return {
        id: match.id,
        challengerId: match.challengerId,
        challengerNickname: challenger?.nickname || `Player_${match.challengerId}`,
        challengerAvatar: challenger?.avatarUrl || null,
        challengerWins: challenger?.lobbyStats?.wins || 0,
        challengerLosses: challenger?.lobbyStats?.losses || 0,
        opponentId: match.opponentId || null,
        wagerAmount,
        categoryId: match.categoryId,
        categoryName: categoryMap[match.categoryId] || 'Unknown',
        status: match.status,
        createdAt: match.createdAt,
        expiresAt: match.expiresAt
      };
    });

    return {
      challenges,
      totalCount: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  /**
   * Get match details
   * 
   * @param {string} matchId - Match UUID
   * @returns {Promise<Object>} - Match object
   */
  async getMatch(matchId) {
    const match = await QuizMatch.findByPk(matchId);

    if (!match) {
      throw new Error('Match not found');
    }

    return match;
  }

  /**
   * Find an active match for a user (for sync/recovery)
   * 
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Optimized match data for client autostart
   */
  async getActiveMatchForUser(userId) {
    const { Op } = require('sequelize');
    
    // Only consider matches started within the last 30 minutes
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    
    // Find most recent active match where user is a participant
    const match = await QuizMatch.findOne({
      where: {
        status: 'active',
        createdAt: { [Op.gte]: cutoff },
        participants: {
          [Op.contains]: [{ userId }]
        }
      },
      order: [['createdAt', 'DESC']]
    });

    if (!match) return null;

    // Build the data the frontend needs to start the game
    return await this.buildChallengeAcceptPayload(match, userId);
  }

  /**
   * Helper to build the match payload for the frontend
   */
  async buildChallengeAcceptPayload(match, userId) {
    const questionService = require('./questionService');
    const UserQuizStats = require('../models/UserQuizStats');

    // Return questions without correct answers
    const questionsForClient = [];
    if (match.questions && match.questions.length > 0) {
      for (const qId of match.questions) {
        try {
          const q = await questionService.getQuestionById(qId);
          if (q) {
            questionsForClient.push({
              id: q.id,
              questionText: q.questionText,
              options: q.options,
              difficulty: q.difficulty
            });
          }
        } catch (e) { console.error('Error fetching question:', e.message); }
      }
    }

    // Determine the opponent (the participant who is NOT the current user)
    const opponentId = match.participants.find(p => p.userId !== userId)?.userId;
    let opponentStats = null;
    if (opponentId) {
      opponentStats = await UserQuizStats.findOne({
        where: { userId: opponentId },
        attributes: ['userId', 'nickname', 'avatarUrl']
      });
    }

    return {
      matchId: match.id,
      challengeId: match.id,
      challengerId: match.challengerId, // <-- CRITICAL FIX: Frontend needs this to assign scores!
      startTime: match.startedAt || new Date(),
      questions: questionsForClient,
      opponent: opponentStats ? {
        userId: opponentStats.userId,
        nickname: opponentStats.nickname,
        avatarUrl: opponentStats.avatarUrl
      } : { userId: 0, nickname: 'Opponent', avatarUrl: null }
    };
  }

  /**
   * Update user quiz statistics after match completion
   * 
   * @param {Object} match - Match object
   * @returns {Promise<void>}
   */
  async updateUserStats(match) {
    // Get actual answer counts from DB for accuracy
    const totalQuestionsInMatch = Array.isArray(match.questions) ? match.questions.length : 10;

    for (const participant of match.participants) {
      const [stats] = await UserQuizStats.findOrCreate({
        where: { userId: participant.userId },
        defaults: { userId: participant.userId }
      });

      const isWinner = participant.userId === match.winnerId;
      const isForfeited = participant.status === 'forfeited';

      // Get actual correct answer count from DB (source of truth)
      const correctCount = await QuizMatchAnswer.count({
        where: { matchId: match.id, userId: participant.userId, isCorrect: true }
      });

      // Update lobby stats
      const lobbyStats = { ...(stats.lobbyStats || {}) };
      lobbyStats.totalMatches = (lobbyStats.totalMatches || 0) + 1;

      if (isWinner) {
        lobbyStats.wins = (lobbyStats.wins || 0) + 1;
        lobbyStats.totalWinnings = (lobbyStats.totalWinnings || 0) + parseFloat(match.escrowAmount || 0);
      } else if (isForfeited) {
        lobbyStats.forfeits = (lobbyStats.forfeits || 0) + 1;
        lobbyStats.totalLosses = (lobbyStats.totalLosses || 0) + parseFloat(participant.wagerAmount || 0);
      } else {
        lobbyStats.losses = (lobbyStats.losses || 0) + 1;
        lobbyStats.totalLosses = (lobbyStats.totalLosses || 0) + parseFloat(participant.wagerAmount || 0);
      }

      lobbyStats.totalWagered = (lobbyStats.totalWagered || 0) + parseFloat(participant.wagerAmount || 0);
      lobbyStats.netProfit = (lobbyStats.totalWinnings || 0) - (lobbyStats.totalLosses || 0);
      lobbyStats.winRate = parseFloat(((lobbyStats.wins || 0) / lobbyStats.totalMatches * 100).toFixed(2));

      // Update overall stats using DB-sourced correct count
      const overallStats = { ...(stats.overallStats || {}) };
      overallStats.totalQuestions = (overallStats.totalQuestions || 0) + totalQuestionsInMatch;
      overallStats.correctAnswers = (overallStats.correctAnswers || 0) + correctCount;
      overallStats.accuracy = parseFloat(((overallStats.correctAnswers / overallStats.totalQuestions) * 100).toFixed(2));

      await stats.update({
        lobbyStats,
        overallStats,
        lastMatchAt: new Date()
      });
    }
  }
}

module.exports = new LobbyService();
