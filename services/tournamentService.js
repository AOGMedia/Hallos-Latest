const sequelize = require('../config/db');
const { Op } = require('sequelize');
const QuizTournament = require('../models/QuizTournament');
const QuizTournamentParticipant = require('../models/QuizTournamentParticipant');
const QuizTournamentRound = require('../models/QuizTournamentRound');
const QuizMatch = require('../models/QuizMatch');
const UserQuizStats = require('../models/UserQuizStats');
const questionService = require('./questionService');
const quizWalletService = require('./quizWalletService');

/**
 * Tournament Service
 * 
 * Manages tournament lifecycle:
 * - Creation and configuration
 * - Registration and entry fees
 * - Tournament execution (multiple formats)
 * - Round progression
 * - Prize distribution
 * 
 * Supported Formats:
 * - Speed Run: Fastest correct completion
 * - Classic: Highest score, time tie-breaker
 * - Knockout: Bracket elimination
 * - Battle Royale: Bottom 25% eliminated each round
 */

class TournamentService {
  /**
   * Create a new tournament
   * 
   * @param {number} adminId - Admin user ID
   * @param {Object} config - Tournament configuration
   * @returns {Promise<{success: boolean, tournamentId: string, tournament: Object}>}
   */
  async createTournament(adminId, config) {
    const {
      name,
      description,
      format,
      entryFee,
      prizeDistribution,
      categoryId,
      maxParticipants,
      minParticipants = 2,
      registrationDeadline,
      startTime
    } = config;

    // Validate required fields
    if (!name || !format || entryFee === undefined || !categoryId || !registrationDeadline || !startTime) {
      throw new Error('Missing required fields: name, format, entryFee, categoryId, registrationDeadline, startTime');
    }

    // Validate format
    const validFormats = ['speed_run', 'classic', 'knockout', 'battle_royale'];
    if (!validFormats.includes(format)) {
      throw new Error(`Invalid format. Must be one of: ${validFormats.join(', ')}`);
    }

    // Validate entry fee
    if (entryFee < 0) {
      throw new Error('Entry fee must be non-negative');
    }

    // Validate dates
    const regDeadline = new Date(registrationDeadline);
    const tournamentStart = new Date(startTime);
    const now = new Date();

    if (regDeadline <= now) {
      throw new Error('Registration deadline must be in the future');
    }

    if (tournamentStart <= regDeadline) {
      throw new Error('Start time must be after registration deadline');
    }

    // Apply default prize distribution if not provided
    const finalPrizeDistribution = prizeDistribution || {
      first: 60,
      second: 30,
      third: 10
    };

    // Validate prize distribution sums to 100
    const total = Object.values(finalPrizeDistribution).reduce((sum, val) => sum + val, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new Error('Prize distribution must sum to 100%');
    }

    // Create tournament
    const tournament = await QuizTournament.create({
      name,
      description,
      format,
      entryFee,
      prizeDistribution: finalPrizeDistribution,
      categoryId,
      maxParticipants,
      minParticipants,
      registrationDeadline: regDeadline,
      startTime: tournamentStart,
      status: 'open',
      currentRound: 0,
      prizePool: 0,
      createdBy: adminId
    });

    return {
      success: true,
      tournamentId: tournament.id,
      tournament
    };
  }

  /**
   * Update tournament (only before registration opens)
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<{success: boolean, tournament: Object}>}
   */
  async updateTournament(tournamentId, updates) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Check if modifications are allowed
    if (tournament.status !== 'draft' && tournament.status !== 'open') {
      throw new Error('Cannot modify tournament after registration has participants');
    }

    // Check if any participants have registered
    const participantCount = await QuizTournamentParticipant.count({
      where: { tournamentId }
    });

    if (participantCount > 0) {
      throw new Error('Cannot modify tournament after participants have registered');
    }

    // Validate updates if they include certain fields
    if (updates.format) {
      const validFormats = ['speed_run', 'classic', 'knockout', 'battle_royale'];
      if (!validFormats.includes(updates.format)) {
        throw new Error(`Invalid format. Must be one of: ${validFormats.join(', ')}`);
      }
    }

    if (updates.prizeDistribution) {
      const total = Object.values(updates.prizeDistribution).reduce((sum, val) => sum + val, 0);
      if (Math.abs(total - 100) > 0.01) {
        throw new Error('Prize distribution must sum to 100%');
      }
    }

    await tournament.update(updates);

    return {
      success: true,
      tournament
    };
  }

  /**
   * Register participant for tournament
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {number} userId - User ID
   * @returns {Promise<{success: boolean, entryFeePaid: number, registrationId: string}>}
   */
  async registerParticipant(tournamentId, userId) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Check tournament status
    if (tournament.status !== 'open') {
      throw new Error('Tournament registration is not open');
    }

    // Check registration deadline
    if (new Date() > new Date(tournament.registrationDeadline)) {
      throw new Error('Registration deadline has passed');
    }

    // Check if already registered
    const existing = await QuizTournamentParticipant.findOne({
      where: { tournamentId, userId }
    });

    if (existing) {
      throw new Error('Already registered for this tournament');
    }

    // Check max participants
    if (tournament.maxParticipants) {
      const currentCount = await QuizTournamentParticipant.count({
        where: { tournamentId }
      });

      if (currentCount >= tournament.maxParticipants) {
        throw new Error('Tournament is full');
      }
    }

    // Verify user balance
    const balanceCheck = await quizWalletService.verifyBalance(userId, tournament.entryFee);
    if (!balanceCheck.sufficient) {
      throw new Error(`Insufficient balance. You have ${balanceCheck.currentBalance} Chuta, need ${tournament.entryFee} Chuta`);
    }

    // Use transaction for atomicity
    const result = await sequelize.transaction(async (t) => {
      // Deduct entry fee
      await quizWalletService.deductTournamentEntry(userId, tournament.entryFee, tournamentId);

      // Add to prize pool
      await tournament.increment('prizePool', { by: tournament.entryFee, transaction: t });

      // Create participant record
      const participant = await QuizTournamentParticipant.create({
        tournamentId,
        userId,
        entryFeePaid: tournament.entryFee,
        status: 'registered',
        currentRound: 0
      }, { transaction: t });

      return {
        success: true,
        entryFeePaid: tournament.entryFee,
        registrationId: participant.id
      };
    });

    return result;
  }

  /**
   * Unregister from tournament (before deadline)
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {number} userId - User ID
   * @returns {Promise<{success: boolean, refundAmount: number}>}
   */
  async unregisterParticipant(tournamentId, userId) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Check if can unregister
    if (new Date() > new Date(tournament.registrationDeadline)) {
      throw new Error('Cannot unregister after registration deadline');
    }

    if (tournament.status !== 'open') {
      throw new Error('Cannot unregister from this tournament');
    }

    const participant = await QuizTournamentParticipant.findOne({
      where: { tournamentId, userId }
    });

    if (!participant) {
      throw new Error('Not registered for this tournament');
    }

    // Use transaction for atomicity
    await sequelize.transaction(async (t) => {
      // Refund entry fee
      await quizWalletService.refundTournamentEntries(tournamentId, [
        { userId, entryFee: participant.entryFeePaid }
      ]);

      // Decrease prize pool
      await tournament.decrement('prizePool', { by: participant.entryFeePaid, transaction: t });

      // Remove participant
      await participant.destroy({ transaction: t });
    });

    return {
      success: true,
      refundAmount: participant.entryFeePaid
    };
  }

  /**
   * Cancel tournament with refunds
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<{success: boolean, refundCount: number, totalRefunded: number}>}
   */
  async cancelTournament(tournamentId, reason) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    if (tournament.status === 'completed' || tournament.status === 'cancelled') {
      throw new Error('Tournament already completed or cancelled');
    }

    // Get all participants
    const participants = await QuizTournamentParticipant.findAll({
      where: { tournamentId }
    });

    if (participants.length === 0) {
      // No participants, just cancel
      await tournament.update({
        status: 'cancelled',
        completedAt: new Date()
      });

      return {
        success: true,
        refundCount: 0,
        totalRefunded: 0
      };
    }

    // Refund all participants
    const refunds = participants.map(p => ({
      userId: p.userId,
      entryFee: p.entryFeePaid
    }));

    const refundResult = await quizWalletService.refundTournamentEntries(tournamentId, refunds);

    // Update tournament
    await tournament.update({
      status: 'cancelled',
      prizePool: 0,
      completedAt: new Date()
    });

    return {
      success: true,
      refundCount: refundResult.refundCount,
      totalRefunded: refundResult.totalRefunded
    };
  }

  /**
   * Start tournament manually
   * 
   * @param {string} tournamentId - Tournament UUID
   * @returns {Promise<{success: boolean, startTime: Date}>}
   */
  async startTournament(tournamentId) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    if (tournament.status !== 'open') {
      throw new Error('Tournament cannot be started');
    }

    // Check minimum participants
    const participantCount = await QuizTournamentParticipant.count({
      where: { tournamentId, status: 'registered' }
    });

    if (participantCount < tournament.minParticipants) {
      throw new Error(`Insufficient participants. Need ${tournament.minParticipants}, have ${participantCount}`);
    }

    // Calculate total rounds based on format
    let totalRounds = 1;
    if (tournament.format === 'knockout') {
      totalRounds = Math.ceil(Math.log2(participantCount));
    } else if (tournament.format === 'battle_royale') {
      // Calculate rounds needed to eliminate to final 2
      let remaining = participantCount;
      totalRounds = 0;
      while (remaining > 2) {
        remaining = Math.ceil(remaining * 0.75); // Keep 75%, eliminate 25%
        totalRounds++;
      }
      totalRounds++; // Final round
    }

    // Update tournament status
    tournament.status = 'active';
    tournament.startTime = new Date();
    await tournament.save();

    return {
      success: true,
      startTime: tournament.startTime
    };
  }

  /**
   * Handle insufficient participants
   * Detects insufficient participants and requires admin approval for refund
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {boolean} adminApproved - Whether admin approved the refund
   * @returns {Promise<{success: boolean, action: string, refundCount?: number, totalRefunded?: number}>}
   */
  async handleInsufficientParticipants(tournamentId, adminApproved = false) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Count registered participants
    const participantCount = await QuizTournamentParticipant.count({
      where: { tournamentId, status: 'registered' }
    });

    // Check if participants are insufficient
    if (participantCount >= tournament.minParticipants) {
      return {
        success: true,
        action: 'sufficient_participants',
        participantCount,
        minRequired: tournament.minParticipants
      };
    }

    // Insufficient participants detected
    if (!adminApproved) {
      // Return status requiring admin approval
      return {
        success: false,
        action: 'requires_admin_approval',
        participantCount,
        minRequired: tournament.minParticipants,
        message: `Tournament has ${participantCount} participants but requires ${tournament.minParticipants}. Admin approval needed for refund.`
      };
    }

    // Admin approved - proceed with refund
    const refundResult = await this.cancelTournament(
      tournamentId,
      `Insufficient participants: ${participantCount}/${tournament.minParticipants}`
    );

    return {
      success: true,
      action: 'refunded',
      participantCount,
      minRequired: tournament.minParticipants,
      refundCount: refundResult.refundCount,
      totalRefunded: refundResult.totalRefunded
    };
  }

  /**
   * Execute a tournament round
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {number} roundNumber - Round number
   * @returns {Promise<void>}
   */
  async executeRound(tournamentId, roundNumber) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Get active participants
    const participants = await QuizTournamentParticipant.findAll({
      where: {
        tournamentId,
        status: { [Op.in]: ['registered', 'active'] }
      }
    });

    // Select questions for this round
    const questions = await questionService.selectBalancedQuestions(tournament.categoryId, 10);
    const questionIds = questions.map(q => q.id);

    // Track question usage
    for (const question of questions) {
      await questionService.trackQuestionUsage(question.id);
    }

    // Create round record
    const round = await QuizTournamentRound.create({
      tournamentId,
      roundNumber,
      questions: questionIds,
      participants: participants.map(p => ({
        userId: p.userId,
        score: 0,
        completionTime: null,
        rank: null
      })),
      eliminatedUsers: [],
      status: 'active',
      startedAt: new Date()
    });

    // Execute format-specific logic
    switch (tournament.format) {
      case 'speed_run':
        await this.executeSpeedRun(tournament, round, participants);
        break;
      case 'classic':
        await this.executeClassic(tournament, round, participants);
        break;
      case 'knockout':
        await this.executeKnockout(tournament, round, participants);
        break;
      case 'battle_royale':
        await this.executeBattleRoyale(tournament, round, participants);
        break;
    }
  }

  /**
   * Execute Speed Run format
   * Rank by fastest correct completion time
   */
  async executeSpeedRun(tournament, round, participants) {
    // In real implementation, this would wait for all participants to complete
    // For now, we'll simulate the ranking logic
    
    // Participants would answer questions via WebSocket
    // After all complete, rank them
    
    // Placeholder: Mark round as completed
    await round.update({
      status: 'completed',
      completedAt: new Date()
    });

    // If final round, distribute prizes
    if (round.roundNumber === tournament.totalRounds) {
      await this.distributePrizes(tournament.id);
    }
  }

  /**
   * Execute Classic format
   * Rank by highest score with time tie-breaker
   */
  async executeClassic(tournament, round, participants) {
    // Similar to Speed Run but different ranking criteria
    
    await round.update({
      status: 'completed',
      completedAt: new Date()
    });

    if (round.roundNumber === tournament.totalRounds) {
      await this.distributePrizes(tournament.id);
    }
  }

  /**
   * Execute Knockout format
   * Bracket-style elimination
   */
  async executeKnockout(tournament, round, participants) {
    // Pair participants for head-to-head matches
    // Winners advance, losers eliminated
    
    await round.update({
      status: 'completed',
      completedAt: new Date()
    });

    // Advance winners to next round or distribute prizes if final
    if (round.roundNumber === tournament.totalRounds) {
      await this.distributePrizes(tournament.id);
    } else {
      await this.executeRound(tournament.id, round.roundNumber + 1);
    }
  }

  /**
   * Execute Battle Royale format
   * Eliminate bottom 25% each round
   */
  async executeBattleRoyale(tournament, round, participants) {
    // All participants answer same questions
    // Bottom 25% eliminated after each round
    
    const eliminateCount = Math.floor(participants.length * 0.25);
    // Would eliminate lowest scorers here
    
    await round.update({
      status: 'completed',
      completedAt: new Date()
    });

    if (round.roundNumber === tournament.totalRounds) {
      await this.distributePrizes(tournament.id);
    } else {
      await this.executeRound(tournament.id, round.roundNumber + 1);
    }
  }

  /**
   * Advance qualifying participants to next round
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {number} currentRoundNumber - Current round number
   * @param {Array} qualifyingUserIds - Array of user IDs who qualified
   * @returns {Promise<void>}
   */
  async advanceToNextRound(tournamentId, currentRoundNumber, qualifyingUserIds) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Validate round number
    if (currentRoundNumber >= tournament.totalRounds) {
      throw new Error('Cannot advance beyond final round');
    }

    // Update participants who qualified
    await QuizTournamentParticipant.update(
      { currentRound: currentRoundNumber + 1 },
      {
        where: {
          tournamentId,
          userId: { [Op.in]: qualifyingUserIds },
          status: 'active'
        }
      }
    );

    // Mark eliminated participants
    const eliminatedParticipants = await QuizTournamentParticipant.findAll({
      where: {
        tournamentId,
        userId: { [Op.notIn]: qualifyingUserIds },
        status: 'active',
        currentRound: currentRoundNumber
      }
    });

    for (const participant of eliminatedParticipants) {
      await participant.update({
        status: 'eliminated',
        eliminatedAt: new Date()
      });
    }

    // Update tournament current round
    await tournament.update({
      currentRound: currentRoundNumber + 1
    });

    console.log(`[TournamentService] Advanced ${qualifyingUserIds.length} participants to round ${currentRoundNumber + 1}`);
    console.log(`[TournamentService] Eliminated ${eliminatedParticipants.length} participants`);
  }

  /**
   * Distribute prizes to top 3 participants
   * 
   * @param {string} tournamentId - Tournament UUID
   * @returns {Promise<void>}
   */
  async distributePrizes(tournamentId) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Get final rankings
    const participants = await QuizTournamentParticipant.findAll({
      where: { tournamentId },
      order: [
        ['totalScore', 'DESC'],
        ['averageTime', 'ASC']
      ],
      limit: 3
    });

    if (participants.length === 0) {
      return;
    }

    const prizePool = parseFloat(tournament.prizePool);
    const distribution = tournament.prizeDistribution;

    // Calculate and award prizes
    const prizes = [
      { placement: 1, percentage: distribution.first || 60 },
      { placement: 2, percentage: distribution.second || 30 },
      { placement: 3, percentage: distribution.third || 10 }
    ];

    for (let i = 0; i < Math.min(participants.length, 3); i++) {
      const participant = participants[i];
      const prize = prizes[i];
      const prizeAmount = Math.floor((prizePool * prize.percentage) / 100);

      // Award prize
      await quizWalletService.awardTournamentPrize(
        participant.userId,
        prizeAmount,
        tournamentId,
        prize.placement
      );

      // Update participant
      await participant.update({
        placement: prize.placement,
        prizeWon: prizeAmount,
        status: prize.placement === 1 ? 'winner' : 'active'
      });

      // Update user stats
      await this.updateUserTournamentStats(participant.userId, tournament, prize.placement, prizeAmount);
    }

    // Mark tournament as completed
    await tournament.update({
      status: 'completed',
      completedAt: new Date()
    });
  }

  /**
   * Update user tournament statistics
   */
  async updateUserTournamentStats(userId, tournament, placement, prizeWon) {
    const [stats] = await UserQuizStats.findOrCreate({
      where: { userId },
      defaults: { userId }
    });

    const tournamentStats = stats.tournamentStats || {};
    tournamentStats.tournamentsEntered = (tournamentStats.tournamentsEntered || 0) + 1;
    
    if (placement === 1) {
      tournamentStats.tournamentsWon = (tournamentStats.tournamentsWon || 0) + 1;
    }
    
    if (placement <= 3) {
      tournamentStats.top3Finishes = (tournamentStats.top3Finishes || 0) + 1;
    }

    tournamentStats.totalPrizeMoney = (tournamentStats.totalPrizeMoney || 0) + prizeWon;
    tournamentStats.totalEntryFees = (tournamentStats.totalEntryFees || 0) + tournament.entryFee;
    tournamentStats.netProfit = (tournamentStats.totalPrizeMoney || 0) - (tournamentStats.totalEntryFees || 0);

    await stats.update({
      tournamentStats,
      lastTournamentAt: new Date()
    });
  }

  /**
   * Get tournament details
   */
  async getTournament(tournamentId) {
    const tournament = await QuizTournament.findByPk(tournamentId, {
      include: [
        {
          model: QuizTournamentParticipant,
          as: 'participants'
        }
      ]
    });

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    return tournament;
  }

  /**
   * Get tournaments list
   */
  async getTournaments(options = {}) {
    const { status, format, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (format) where.format = format;

    const { count, rows } = await QuizTournament.findAndCountAll({
      where,
      limit,
      offset,
      order: [['startTime', 'ASC']]
    });

    return {
      tournaments: rows,
      totalCount: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  /**
   * Get tournament leaderboard
   */
  async getTournamentLeaderboard(tournamentId) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    const participants = await QuizTournamentParticipant.findAll({
      where: { tournamentId },
      order: [
        ['totalScore', 'DESC'],
        ['averageTime', 'ASC']
      ]
    });

    return {
      participants,
      currentRound: tournament.currentRound,
      totalRounds: tournament.totalRounds,
      status: tournament.status
    };
  }
}

module.exports = new TournamentService();
