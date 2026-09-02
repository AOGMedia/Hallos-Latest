const sequelize = require('../config/db');
const { Op, fn, col } = require('sequelize');
const QuizTournament = require('../models/QuizTournament');
const QuizTournamentParticipant = require('../models/QuizTournamentParticipant');
const QuizTournamentRound = require('../models/QuizTournamentRound');
const QuizTournamentAnswer = require('../models/QuizTournamentAnswer');
const QuizMatch = require('../models/QuizMatch');
const UserQuizStats = require('../models/UserQuizStats');
const questionService = require('./questionService');
const quizWalletService = require('./quizWalletService');

const SHARED_QUESTION_FORMATS = ['classic', 'speed_run', 'battle_royale'];
const QUESTIONS_PER_ROUND = 10;

// Single source of truth for round pacing. QUESTION_TIME_LIMIT_SEC is sent to
// the client in `round_started`, so the countdown it renders and the window the
// server scores against can't drift apart. The acceptance ceiling adds the
// client's post-answer reveal pause plus a latency allowance, because a
// participant's clock for question N only stops when their answer lands here.
const QUESTION_TIME_LIMIT_SEC = 10;
const ANSWER_REVEAL_SEC = 1.5;
const LATENCY_GRACE_SEC = 2;
const MAX_ANSWER_ELAPSED_SEC = QUESTION_TIME_LIMIT_SEC + ANSWER_REVEAL_SEC + LATENCY_GRACE_SEC;
const ROUND_MAX_DURATION_MS = (QUESTIONS_PER_ROUND * MAX_ANSWER_ELAPSED_SEC + 30) * 1000;

// Knockout matches have no accept/decline step and no per-participant expiry,
// so a no-show opponent leaves the match 'active' forever, which blocks the
// entire round (round-advance requires every match to reach 'completed').
// These sweeps give the match a real deadline instead.
const KNOCKOUT_NO_SHOW_GRACE_MS = 3 * 60 * 1000;
const KNOCKOUT_BOTH_ABSENT_GRACE_MS = 6 * 60 * 1000;

// Guards against startTournament() committing status:'in_progress' and then
// executeRound(id, 1) throwing before round 1 is ever created, which would
// otherwise leave the tournament permanently stuck with no automatic retry.
const STUCK_START_GRACE_MS = 2 * 60 * 1000;

// Discovery endpoint only surfaces a knockout match started within this
// window — mirrors lobbyService.getActiveMatchForUser's own cutoff.
const ACTIVE_MATCH_LOOKBACK_MS = 30 * 60 * 1000;

/**
 * Emit a socket event to a specific user if connected, or queue it for
 * delivery on reconnect. Mirrors lobbyService's `_emitToUser`/`sendOrQueue`
 * usage so tournament and lobby notifications behave consistently.
 */
function emitToUser(userId, event, payload) {
  try {
    const websocketManager = require('./websocketManager');
    websocketManager.sendOrQueue(userId, event, payload);
  } catch (e) {
    console.error(`[TournamentService] Failed to emit '${event}' to user ${userId}:`, e.message);
  }
}

function emitToTournamentRoom(tournamentId, event, payload) {
  try {
    const websocketManager = require('./websocketManager');
    if (websocketManager.io) {
      websocketManager.io.to(`tournament:${tournamentId}`).emit(event, payload);
    }
  } catch (e) {
    console.error(`[TournamentService] Failed to broadcast '${event}' for tournament ${tournamentId}:`, e.message);
  }
}

/** Fisher-Yates shuffle — used for random bracket seeding. */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

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

const VALID_TOURNAMENT_FORMATS = ['speed_run', 'classic', 'knockout', 'battle_royale'];
// Rounds for knockout/battle_royale are mathematically derived from the final
// registered headcount at start time (a bracket size isn't a free choice).
// classic/speed_run have no elimination mechanic to derive a round count
// from, so unlike the other two, an organizer configures it directly — same
// as they already do for entryFee, participant caps, and prize split.
const CONFIGURABLE_ROUNDS_FORMATS = ['classic', 'speed_run'];
const DEFAULT_TOURNAMENT_ROUNDS = 3;
const MIN_TOURNAMENT_ROUNDS = 1;
const MAX_TOURNAMENT_ROUNDS = 10;

class TournamentService {
  /**
   * Shared validation for both admin-created and user-proposed tournaments —
   * everything except who's allowed to create one and what status it starts
   * in is identical.
   */
  _validateTournamentConfig(config) {
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
      startTime,
      totalRounds
    } = config;

    if (!name || !format || entryFee === undefined || !categoryId || !registrationDeadline || !startTime) {
      throw new Error('Missing required fields: name, format, entryFee, categoryId, registrationDeadline, startTime');
    }

    if (!VALID_TOURNAMENT_FORMATS.includes(format)) {
      throw new Error(`Invalid format. Must be one of: ${VALID_TOURNAMENT_FORMATS.join(', ')}`);
    }

    if (entryFee < 0) {
      throw new Error('Entry fee must be non-negative');
    }

    if (maxParticipants !== undefined && maxParticipants !== null && maxParticipants < minParticipants) {
      throw new Error('maxParticipants cannot be less than minParticipants');
    }

    const regDeadline = new Date(registrationDeadline);
    const tournamentStart = new Date(startTime);
    const now = new Date();

    if (regDeadline <= now) {
      throw new Error('Registration deadline must be in the future');
    }

    if (tournamentStart <= regDeadline) {
      throw new Error('Start time must be after registration deadline');
    }

    const finalPrizeDistribution = prizeDistribution || { first: 60, second: 30, third: 10 };
    const total = Object.values(finalPrizeDistribution).reduce((sum, val) => sum + val, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new Error('Prize distribution must sum to 100%');
    }

    // Only classic/speed_run take a configured round count — knockout and
    // battle_royale compute theirs from the final registered headcount when
    // the tournament starts (see startTournament), so any totalRounds
    // submitted for those two formats is intentionally ignored rather than
    // stored, to avoid a stale/meaningless value sitting on the row before
    // start time overwrites it anyway.
    let finalTotalRounds;
    if (CONFIGURABLE_ROUNDS_FORMATS.includes(format)) {
      finalTotalRounds = totalRounds === undefined || totalRounds === null
        ? DEFAULT_TOURNAMENT_ROUNDS
        : parseInt(totalRounds, 10);

      if (!Number.isInteger(finalTotalRounds) || finalTotalRounds < MIN_TOURNAMENT_ROUNDS || finalTotalRounds > MAX_TOURNAMENT_ROUNDS) {
        throw new Error(`totalRounds must be an integer between ${MIN_TOURNAMENT_ROUNDS} and ${MAX_TOURNAMENT_ROUNDS}`);
      }
    }

    return {
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
      ...(finalTotalRounds !== undefined && { totalRounds: finalTotalRounds })
    };
  }

  /**
   * Create a new tournament (admin path — goes straight to 'open', no review).
   *
   * @param {number} adminId - Admin user ID
   * @param {Object} config - Tournament configuration
   * @returns {Promise<{success: boolean, tournamentId: string, tournament: Object}>}
   */
  async createTournament(adminId, config) {
    const built = this._validateTournamentConfig(config);

    const tournament = await QuizTournament.create({
      ...built,
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
   * Propose a user-hosted tournament — same validation as an admin-created
   * one, but starts in 'pending_review' and only becomes visible/joinable
   * once an admin approves it (see approveTournamentProposal).
   *
   * @param {number} userId - Proposing user's ID
   * @param {Object} config - Tournament configuration
   */
  async proposeTournament(userId, config) {
    const built = this._validateTournamentConfig(config);

    const tournament = await QuizTournament.create({
      ...built,
      status: 'pending_review',
      currentRound: 0,
      prizePool: 0,
      createdBy: userId,
      proposedBy: userId
    });

    return {
      success: true,
      tournamentId: tournament.id,
      tournament
    };
  }

  /**
   * List pending tournament proposals for admin review.
   */
  async listProposals(options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const { count, rows } = await QuizTournament.findAndCountAll({
      where: { status: 'pending_review' },
      limit,
      offset,
      order: [['createdAt', 'ASC']]
    });

    return {
      proposals: rows,
      totalCount: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  /**
   * Approve a pending proposal — opens it for registration exactly like an
   * admin-created tournament from this point on.
   */
  async approveTournamentProposal(tournamentId, adminId) {
    const tournament = await QuizTournament.findByPk(tournamentId);
    if (!tournament) {
      throw new Error('Tournament not found');
    }
    if (tournament.status !== 'pending_review') {
      throw new Error('Only pending-review proposals can be approved');
    }

    await tournament.update({
      status: 'open',
      reviewedBy: adminId,
      reviewedAt: new Date()
    });

    if (tournament.proposedBy) {
      emitToUser(tournament.proposedBy, 'tournament_proposal_approved', { tournamentId });
    }

    return { success: true, tournament };
  }

  /**
   * Reject a pending proposal — no money has moved yet at this stage
   * (proposals don't collect entry fees, only registration does), so there's
   * nothing to refund.
   */
  async rejectTournamentProposal(tournamentId, adminId, reason) {
    const tournament = await QuizTournament.findByPk(tournamentId);
    if (!tournament) {
      throw new Error('Tournament not found');
    }
    if (tournament.status !== 'pending_review') {
      throw new Error('Only pending-review proposals can be rejected');
    }

    await tournament.update({
      status: 'rejected',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: reason || null
    });

    if (tournament.proposedBy) {
      emitToUser(tournament.proposedBy, 'tournament_proposal_rejected', { tournamentId, reason: reason || null });
    }

    return { success: true };
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
    if (!['draft', 'pending_review', 'open'].includes(tournament.status)) {
      throw new Error('Cannot modify tournament after it has started');
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
      if (!VALID_TOURNAMENT_FORMATS.includes(updates.format)) {
        throw new Error(`Invalid format. Must be one of: ${VALID_TOURNAMENT_FORMATS.join(', ')}`);
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
  async registerParticipant(tournamentId, userId, options = {}) {
    const { ip = null } = options;

    // Everything — the capacity check, the balance check+debit, and the
    // participant insert — happens inside one transaction, with the
    // tournament row locked for its duration. That closes both known races:
    // two concurrent registrations can no longer both slip past the
    // maxParticipants check (they're serialized on the tournament row lock),
    // and deductTournamentEntry's own per-user advisory lock (see
    // quizWalletService.lockUserWallet) prevents the same user's balance
    // check from being read twice before either debit commits.
    const result = await sequelize.transaction(async (t) => {
      const tournament = await QuizTournament.findByPk(tournamentId, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      if (tournament.status !== 'open') {
        throw new Error('Tournament registration is not open');
      }

      if (new Date() > new Date(tournament.registrationDeadline)) {
        throw new Error('Registration deadline has passed');
      }

      const existing = await QuizTournamentParticipant.findOne({
        where: { tournamentId, userId },
        transaction: t
      });

      if (existing) {
        throw new Error('Already registered for this tournament');
      }

      if (tournament.maxParticipants) {
        const currentCount = await QuizTournamentParticipant.count({
          where: { tournamentId },
          transaction: t
        });

        if (currentCount >= tournament.maxParticipants) {
          throw new Error('Tournament is full');
        }
      }

      const balanceCheck = await quizWalletService.verifyBalance(userId, tournament.entryFee);
      if (!balanceCheck.sufficient) {
        throw new Error(`Insufficient balance. You have ${balanceCheck.currentBalance} Chuta, need ${tournament.entryFee} Chuta`);
      }

      // Deduct entry fee — atomic with everything else in this transaction
      await quizWalletService.deductTournamentEntry(userId, tournament.entryFee, tournamentId, t);

      // Add to prize pool
      await tournament.increment('prizePool', { by: tournament.entryFee, transaction: t });

      // Create participant record
      const participant = await QuizTournamentParticipant.create({
        tournamentId,
        userId,
        entryFeePaid: tournament.entryFee,
        status: 'registered',
        currentRound: 0,
        registrationIp: ip
      }, { transaction: t });

      return {
        success: true,
        entryFeePaid: tournament.entryFee,
        registrationId: participant.id
      };
    });

    // Fire-and-forget fairness signal — never blocks or fails registration.
    this._flagSuspiciousRegistration(tournamentId, userId, ip).catch(err => {
      console.error('[TournamentService] Fairness check failed (non-critical):', err.message);
    });

    return result;
  }

  /**
   * Non-blocking collusion signal: flag (don't block) when a registration's IP
   * matches another participant already registered for the same tournament.
   * Real players sharing a wifi/cyber cafe is common and shouldn't be
   * punished automatically — this only surfaces the pattern for admin review
   * via the existing suspiciousActivityService violation counter.
   */
  async _flagSuspiciousRegistration(tournamentId, userId, ip) {
    if (!ip) return;

    const sameIpCount = await QuizTournamentParticipant.count({
      where: {
        tournamentId,
        registrationIp: ip,
        userId: { [Op.ne]: userId }
      }
    });

    if (sameIpCount > 0) {
      const suspiciousActivityService = require('./suspiciousActivityService');
      await suspiciousActivityService.flagSuspiciousPattern(userId, {
        reason: 'tournament_registration_same_ip',
        tournamentId,
        matchingParticipants: sameIpCount
      });
    }
  }

  /**
   * Unregister from tournament (before deadline)
   * 
   * @param {string} tournamentId - Tournament UUID
   * @param {number} userId - User ID
   * @returns {Promise<{success: boolean, refundAmount: number}>}
   */
  async unregisterParticipant(tournamentId, userId) {
    // The participant row is locked for the duration of the transaction, so
    // two concurrent unregister calls for the same user can't both find it
    // still present and both trigger a refund (the second waits for the
    // first to commit the destroy, then legitimately gets "not registered").
    return sequelize.transaction(async (t) => {
      const tournament = await QuizTournament.findByPk(tournamentId, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      if (new Date() > new Date(tournament.registrationDeadline)) {
        throw new Error('Cannot unregister after registration deadline');
      }

      if (tournament.status !== 'open') {
        throw new Error('Cannot unregister from this tournament');
      }

      const participant = await QuizTournamentParticipant.findOne({
        where: { tournamentId, userId },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!participant) {
        throw new Error('Not registered for this tournament');
      }

      const refundAmount = participant.entryFeePaid;

      await quizWalletService.refundTournamentEntries(
        tournamentId,
        [{ userId, entryFee: refundAmount }],
        t
      );

      await tournament.decrement('prizePool', { by: refundAmount, transaction: t });
      await participant.destroy({ transaction: t });

      return {
        success: true,
        refundAmount
      };
    });
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
    // Lock the tournament row for the status-transition + rounds calculation,
    // so a cron auto-start and a manual admin start racing each other can't
    // both flip it to in_progress and both call executeRound(1).
    const { totalRounds, participantCount } = await sequelize.transaction(async (t) => {
      const tournament = await QuizTournament.findByPk(tournamentId, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      if (tournament.status !== 'open') {
        throw new Error('Tournament cannot be started');
      }

      const count = await QuizTournamentParticipant.count({
        where: { tournamentId, status: 'registered' },
        transaction: t
      });

      if (count < tournament.minParticipants) {
        throw new Error(`Insufficient participants. Need ${tournament.minParticipants}, have ${count}`);
      }

      // Calculate total rounds based on format. classic/speed_run already
      // have an organizer-configured value from creation time (see
      // _validateTournamentConfig) — preserve it rather than resetting to 1;
      // the fallback only matters for rows created before this existed.
      // knockout/battle_royale always overwrite this below regardless, since
      // their round count can only be known once the final headcount is in.
      let rounds = tournament.totalRounds || DEFAULT_TOURNAMENT_ROUNDS;
      if (tournament.format === 'knockout') {
        rounds = Math.ceil(Math.log2(count));
      } else if (tournament.format === 'battle_royale') {
        // Keep 75%, eliminate 25% per round — but `Math.ceil(3 * 0.75)` is 3,
        // a fixed point of the raw recurrence: once the field reached exactly
        // 3 it never shrank again, and this loop spun forever. Since it runs
        // synchronously inside this transaction's row lock with no `await`,
        // that wasn't just one stuck tournament — it froze the entire Node
        // event loop, and the lifecycle-sweep cron auto-starts any due
        // tournament with enough registrants, so any battle_royale tournament
        // with 3+ participants reaching its start time took the whole backend
        // down. `Math.min(remaining - 1, ...)` guarantees the field strictly
        // shrinks by at least 1 every iteration, so it always reaches 2.
        let remaining = count;
        rounds = 0;
        while (remaining > 2) {
          remaining = Math.max(2, Math.min(remaining - 1, Math.ceil(remaining * 0.75)));
          rounds++;
        }
        rounds++; // Final round
      }

      await QuizTournamentParticipant.update(
        { status: 'active' },
        { where: { tournamentId, status: 'registered' }, transaction: t }
      );

      await tournament.update({
        status: 'in_progress',
        startTime: new Date(),
        totalRounds: rounds,
        currentRound: 0
      }, { transaction: t });

      return { totalRounds: rounds, participantCount: count };
    });

    const tournament = await QuizTournament.findByPk(tournamentId);

    try {
      require('./websocketManager').broadcastTournamentStarted(tournamentId, {
        format: tournament.format,
        participantCount,
        totalRounds,
        startTime: tournament.startTime
      });
    } catch (e) {
      console.error('[TournamentService] broadcastTournamentStarted failed:', e.message);
    }

    // Kick off round 1. Errors here shouldn't leave the tournament stuck in
    // 'in_progress' with no round — surface them, the admin can retry/cancel.
    await this.executeRound(tournamentId, 1);

    return {
      success: true,
      startTime: tournament.startTime,
      totalRounds
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
   * Execute (start) a tournament round — creates the round record and hands
   * off to the format-specific starter. Idempotent: if the round already
   * exists (e.g. a cron sweep and a match-completion callback both tried to
   * advance at once), this is a silent no-op rather than a duplicate round.
   *
   * @param {string} tournamentId - Tournament UUID
   * @param {number} roundNumber - Round number
   */
  async executeRound(tournamentId, roundNumber) {
    const tournament = await QuizTournament.findByPk(tournamentId);
    if (!tournament) {
      throw new Error('Tournament not found');
    }

    const participants = await QuizTournamentParticipant.findAll({
      where: { tournamentId, status: 'active' }
    });

    let round;
    try {
      round = await QuizTournamentRound.create({
        tournamentId,
        roundNumber,
        questions: [],
        participants: participants.map(p => ({ userId: p.userId, score: 0, completionTime: null, rank: null })),
        eliminatedUsers: [],
        status: 'pending'
      });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        console.warn(`[TournamentService] Round ${roundNumber} for tournament ${tournamentId} already exists, skipping duplicate start`);
        return;
      }
      throw err;
    }

    if (tournament.format === 'knockout') {
      await this._startKnockoutRound(tournament, round, participants);
    } else {
      await this._startSharedQuestionRound(tournament, round, participants);
    }
  }

  // =======================================================================
  // Knockout format — real head-to-head matches, reusing the 1v1 lobby
  // engine (lobbyService/QuizMatch) rather than reinventing scoring.
  // =======================================================================

  /**
   * Pair participants for a knockout round and create a real QuizMatch per
   * pair. No escrow/wager — entry fees were already collected at
   * registration, so matches start directly 'active' (no accept/decline
   * dance). Each match gets its own independently-drawn question set to
   * avoid two simultaneous pairs in the same round being able to relay
   * answers to each other.
   */
  async _startKnockoutRound(tournament, round, participants) {
    const shuffled = shuffle(participants);
    const roundEntries = [];
    let byeUserId = null;

    if (shuffled.length % 2 === 1) {
      byeUserId = shuffled.pop().userId;
    }

    const matchPromises = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      matchPromises.push(this._createKnockoutMatch(tournament, round, shuffled[i], shuffled[i + 1]));
    }
    const matches = await Promise.all(matchPromises);

    for (const { p1, p2, match } of matches) {
      roundEntries.push({ userId: p1.userId, matchId: match.id, score: 0, completionTime: null, rank: null });
      roundEntries.push({ userId: p2.userId, matchId: match.id, score: 0, completionTime: null, rank: null });
    }
    if (byeUserId !== null) {
      roundEntries.push({ userId: byeUserId, matchId: null, bye: true, score: 0, completionTime: null, rank: null });
    }

    await round.update({
      participants: roundEntries,
      status: 'active',
      startedAt: new Date()
    });

    emitToTournamentRoom(tournament.id, 'round_started', {
      tournamentId: tournament.id,
      roundNumber: round.roundNumber,
      format: 'knockout',
      matchCount: matches.length,
      totalQuestions: QUESTIONS_PER_ROUND,
      timeLimit: QUESTION_TIME_LIMIT_SEC,
      byeUserId
    });

    if (byeUserId !== null) {
      emitToUser(byeUserId, 'tournament_bye', { tournamentId: tournament.id, roundNumber: round.roundNumber });
    }
  }

  async _createKnockoutMatch(tournament, round, p1, p2) {
    const questions = await questionService.selectBalancedQuestions(tournament.categoryId, QUESTIONS_PER_ROUND);
    const questionIds = questions.map(q => q.id);
    for (const q of questions) {
      await questionService.trackQuestionUsage(q.id);
    }

    const questionStartTimesRaw = {};
    questionIds.forEach(qId => { questionStartTimesRaw[qId] = null; });

    const match = await QuizMatch.create({
      matchType: 'tournament',
      tournamentId: tournament.id,
      roundNumber: round.roundNumber,
      categoryId: tournament.categoryId,
      challengerId: p1.userId,
      opponentId: p2.userId,
      participants: [
        { userId: p1.userId, wagerAmount: 0, status: 'active', score: 0, completionTime: null, answers: [] },
        { userId: p2.userId, wagerAmount: 0, status: 'active', score: 0, completionTime: null, answers: [] }
      ],
      questions: questionIds,
      questionStartTimes: JSON.parse(JSON.stringify(questionStartTimesRaw)),
      status: 'active',
      escrowAmount: 0,
      startedAt: new Date()
    });

    const questionsForClient = questions.map(q => ({
      id: q.id,
      questionText: q.questionText,
      options: q.options,
      difficulty: q.difficulty
    }));

    const [p1Stats, p2Stats] = await Promise.all([
      UserQuizStats.findOne({ where: { userId: p1.userId }, attributes: ['userId', 'nickname', 'avatarUrl'] }),
      UserQuizStats.findOne({ where: { userId: p2.userId }, attributes: ['userId', 'nickname', 'avatarUrl'] })
    ]);

    // Reuse the exact 'challenge_accepted' shape the lobby's Gameplay screen
    // already knows how to render — a tournament knockout match is, from the
    // client's perspective, just a match with a different starting screen.
    emitToUser(p1.userId, 'challenge_accepted', {
      challengeId: match.id, matchId: match.id, startTime: match.startedAt, questions: questionsForClient,
      tournamentId: tournament.id, roundNumber: round.roundNumber,
      opponent: { userId: p2.userId, nickname: p2Stats?.nickname || `Player_${p2.userId}`, avatarUrl: p2Stats?.avatarUrl || null }
    });
    emitToUser(p2.userId, 'challenge_accepted', {
      challengeId: match.id, matchId: match.id, startTime: match.startedAt, questions: questionsForClient,
      tournamentId: tournament.id, roundNumber: round.roundNumber,
      opponent: { userId: p1.userId, nickname: p1Stats?.nickname || `Player_${p1.userId}`, avatarUrl: p1Stats?.avatarUrl || null }
    });

    // Publish to the app-wide "Live Now" feed. Knockout matches are the most
    // watchable thing on the platform, and standings already make tournament
    // participation public, so nothing new is exposed here.
    try {
      require('./websocketManager').liveMatchStarted({
        matchId: match.id,
        matchType: 'tournament',
        tournamentName: tournament.name || null,
        roundNumber: round.roundNumber,
        players: [
          { userId: p1.userId, nickname: p1Stats?.nickname || `Player_${p1.userId}`, avatarUrl: p1Stats?.avatarUrl || null },
          { userId: p2.userId, nickname: p2Stats?.nickname || `Player_${p2.userId}`, avatarUrl: p2Stats?.avatarUrl || null }
        ]
      });
    } catch (feedError) {
      console.error('[TournamentService] Live feed publish failed:', feedError.message);
    }

    return { p1, p2, match };
  }

  /**
   * Called by lobbyService.endMatch when a tournament-type match finishes
   * (normal completion or forfeit). Checks whether every match in this round
   * has finished, and if so, advances the bracket.
   */
  async onTournamentMatchEnded(match) {
    const tournament = await QuizTournament.findByPk(match.tournamentId);
    if (!tournament || tournament.status !== 'in_progress') return;

    const stillPlaying = await QuizMatch.count({
      where: {
        tournamentId: match.tournamentId,
        roundNumber: match.roundNumber,
        status: { [Op.ne]: 'completed' }
      }
    });
    if (stillPlaying > 0) return; // other pairs in this round are still playing

    await sequelize.transaction(async (t) => {
      const round = await QuizTournamentRound.findOne({
        where: { tournamentId: match.tournamentId, roundNumber: match.roundNumber },
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!round || round.status === 'completed') return; // already handled by a concurrent caller

      const roundMatches = await QuizMatch.findAll({
        where: { tournamentId: match.tournamentId, roundNumber: match.roundNumber },
        transaction: t
      });

      const qualifyingUserIds = roundMatches.map(m => m.winnerId).filter(Boolean);
      const byeEntry = round.participants.find(p => p.bye);
      if (byeEntry) qualifyingUserIds.push(byeEntry.userId);

      const updatedEntries = round.participants.map(entry => {
        if (entry.bye) return entry;
        const m = roundMatches.find(rm => rm.id === entry.matchId);
        if (!m) return entry;
        const mp = m.participants.find(p => p.userId === entry.userId);
        return { ...entry, score: mp?.score ?? 0, completionTime: mp?.completionTime ?? null };
      });

      // Sync each entrant's real match score onto QuizTournamentParticipant.totalScore
      // — the field the per-tournament leaderboard (getTournamentLeaderboard)
      // and _rankParticipants' tiebreak both read. Knockout had no write site
      // for this at all: the only other write, in _completeSharedQuestionRound,
      // runs exclusively for the shared-question formats (classic/speed_run/
      // battle_royale). Without this, every knockout entrant's leaderboard
      // score stayed permanently 0 regardless of how they actually played.
      // Both the winner and the loser of this round are updated here —
      // elimination (advanceToNextRound, called later via
      // _finishRoundAndContinue) hasn't run yet at this point, so both are
      // still 'active'; totalScore is also what breaks a tie between two
      // players eliminated in the same round, so the loser's score matters too.
      for (const entry of updatedEntries) {
        if (entry.bye) continue;
        const participant = await QuizTournamentParticipant.findOne({
          where: { tournamentId: match.tournamentId, userId: entry.userId },
          transaction: t,
          lock: t.LOCK.UPDATE
        });
        if (!participant || participant.status !== 'active') continue;
        await participant.update(
          { totalScore: (participant.totalScore || 0) + (entry.score || 0) },
          { transaction: t }
        );
      }

      round.eliminatedUsers = roundMatches.map(m => {
        const loserEntry = m.participants.find(p => p.userId !== m.winnerId);
        return loserEntry?.userId;
      }).filter(Boolean);
      this._assignRoundRanks(updatedEntries);
      round.participants = updatedEntries;
      round.changed('participants', true);
      round.changed('eliminatedUsers', true);
      await round.update({ status: 'completed', completedAt: new Date() }, { transaction: t });
    });

    const finishedRound = await QuizTournamentRound.findOne({
      where: { tournamentId: match.tournamentId, roundNumber: match.roundNumber }
    });
    try {
      require('./websocketManager').broadcastRoundEnded(match.tournamentId, {
        roundNumber: match.roundNumber,
        results: finishedRound.participants
      });
    } catch (e) {
      console.error('[TournamentService] broadcastRoundEnded failed:', e.message);
    }

    await this._finishRoundAndContinue(tournament, match.roundNumber, this._collectKnockoutQualifiers);
  }

  async _collectKnockoutQualifiers(tournamentId, roundNumber) {
    const round = await QuizTournamentRound.findOne({ where: { tournamentId, roundNumber } });
    const matches = await QuizMatch.findAll({ where: { tournamentId, roundNumber } });
    const qualifiers = matches.map(m => m.winnerId).filter(Boolean);
    const byeEntry = round.participants.find(p => p.bye);
    if (byeEntry) qualifiers.push(byeEntry.userId);
    return qualifiers;
  }

  // =======================================================================
  // Shared-question-set formats (classic, speed_run, battle_royale) — every
  // active participant answers the same question set independently.
  // =======================================================================

  async _startSharedQuestionRound(tournament, round, participants) {
    const questions = await questionService.selectBalancedQuestions(tournament.categoryId, QUESTIONS_PER_ROUND);
    const questionIds = questions.map(q => q.id);
    for (const q of questions) {
      await questionService.trackQuestionUsage(q.id);
    }

    await round.update({
      questions: questionIds,
      status: 'active',
      startedAt: new Date()
    });

    const questionsForClient = questions.map(q => ({
      id: q.id, questionText: q.questionText, options: q.options, difficulty: q.difficulty
    }));

    emitToTournamentRoom(tournament.id, 'round_started', {
      tournamentId: tournament.id,
      roundNumber: round.roundNumber,
      format: tournament.format,
      questions: questionsForClient,
      totalQuestions: questionsForClient.length,
      timeLimit: QUESTION_TIME_LIMIT_SEC,
      startTime: round.startedAt
    });
  }

  /**
   * Submit an answer for a shared-question-set tournament round.
   * Mirrors lobbyService.submitAnswer's locking/timing/scoring pattern.
   */
  async submitAnswer(tournamentId, roundNumber, userId, questionId, answerId, clientTimestamp) {
    const roundComplete = await sequelize.transaction(async (t) => {
      const round = await QuizTournamentRound.findOne({
        where: { tournamentId, roundNumber },
        lock: t.LOCK.UPDATE,
        transaction: t
      });
      if (!round) throw new Error('Round not found');
      if (round.status !== 'active') throw new Error('Round is not active');
      if (!round.questions.includes(questionId)) throw new Error('Invalid question for this round');

      const participant = await QuizTournamentParticipant.findOne({
        where: { tournamentId, userId, status: 'active' },
        transaction: t
      });
      if (!participant) throw new Error('User is not an active participant in this tournament');

      const existingAnswer = await QuizTournamentAnswer.findOne({
        where: { roundId: round.id, userId, questionId },
        transaction: t
      });
      if (existingAnswer) throw new Error('Question already answered');

      const questionService_ = require('./questionService');
      const question = await questionService_.getQuestionById(questionId, true);

      const serverTime = Date.now();

      // Every participant is paced by their own client, so question N's clock
      // starts when *their* previous answer landed — not when whoever happened
      // to answer it first did. A round-wide start stamp meant a participant
      // trailing the fastest one by more than the ceiling had every remaining
      // answer coerced to 'timeout', and gave the first submitter of each
      // question a free elapsed-of-zero (maximum speed bonus). Deriving the
      // basis from the participant's own answer trail fixes both.
      const priorAnswer = await QuizTournamentAnswer.findOne({
        where: { roundId: round.id, userId },
        order: [['serverTimestamp', 'DESC']],
        transaction: t
      });
      const questionStartTime = priorAnswer
        ? Number(priorAnswer.serverTimestamp)
        : new Date(round.startedAt).getTime();

      const elapsed = Math.max((serverTime - questionStartTime) / 1000, 0);
      let finalAnswerId = answerId;
      if (elapsed > MAX_ANSWER_ELAPSED_SEC && finalAnswerId.toLowerCase() !== 'timeout') {
        finalAnswerId = 'timeout';
      }

      const clientTimeInt = Math.floor(Number(clientTimestamp));
      const latency = serverTime - clientTimeInt;
      // Clamped at both ends: a skewed client clock or a reconnect flush must
      // not yield a negative time, nor one longer than the question was open.
      const adjustedTime = Math.min(
        Math.max(elapsed - (latency / 1000), 0),
        QUESTION_TIME_LIMIT_SEC
      );

      const isCorrect = (finalAnswerId.toLowerCase() !== 'timeout') && (question.correctAnswer === finalAnswerId.toLowerCase());
      const lobbyService = require('./lobbyService');
      const pointsEarned = isCorrect ? lobbyService.calculatePoints(question.difficulty, adjustedTime) : 0;

      await QuizTournamentAnswer.create({
        roundId: round.id,
        tournamentId,
        userId,
        questionId,
        selectedAnswer: finalAnswerId.toLowerCase(),
        isCorrect,
        responseTime: adjustedTime,
        clientTimestamp: clientTimeInt || serverTime,
        serverTimestamp: serverTime,
        latency: Math.floor(latency)
      }, { transaction: t });

      const entry = round.participants.find(p => p.userId === userId);
      if (entry) {
        entry.score = (entry.score || 0) + pointsEarned;
        entry.answers = entry.answers || [];
        entry.answers.push(questionId);
        round.changed('participants', true);
        await round.save({ transaction: t });
      }

      const activeEntries = round.participants.filter(p => !p.bye);
      const allDone = activeEntries.length > 0 && activeEntries.every(p => (p.answers?.length || 0) >= round.questions.length);

      return { isCorrect, correctAnswer: question.correctAnswer, pointsEarned, adjustedTime, allDone };
    });

    if (roundComplete.allDone) {
      setTimeout(() => {
        this._completeSharedQuestionRound(tournamentId, roundNumber).catch(err => {
          console.error('[TournamentService] _completeSharedQuestionRound failed:', err.message);
        });
      }, 0);
    }

    return {
      success: true,
      correct: roundComplete.isCorrect,
      correctAnswer: roundComplete.correctAnswer,
      pointsEarned: roundComplete.pointsEarned,
      responseTime: roundComplete.adjustedTime
    };
  }

  /**
   * Assign a 1-indexed rank to each round entry — higher score first, faster
   * completion breaking ties. Mutates the entries in place (they're JSONB rows
   * the caller is about to persist). Bye entries never played the round, so
   * they keep a null rank rather than being sorted to the bottom on a zero
   * score. This is what populates `rank` in the `round_ended` broadcast; it was
   * previously initialised to null and never written.
   */
  _assignRoundRanks(entries) {
    const played = entries.filter(e => !e.bye);
    played.sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      const timeA = a.completionTime == null ? Infinity : a.completionTime;
      const timeB = b.completionTime == null ? Infinity : b.completionTime;
      return timeA - timeB;
    });
    played.forEach((entry, index) => { entry.rank = index + 1; });
    for (const entry of entries) {
      if (entry.bye) entry.rank = null;
    }
    return entries;
  }

  async _completeSharedQuestionRound(tournamentId, roundNumber) {
    const tournament = await QuizTournament.findByPk(tournamentId);
    if (!tournament) return;

    const alreadyDone = await sequelize.transaction(async (t) => {
      const round = await QuizTournamentRound.findOne({
        where: { tournamentId, roundNumber },
        lock: t.LOCK.UPDATE,
        transaction: t
      });
      if (!round || round.status === 'completed') return true; // idempotent

      // Compute completion time per participant from their answer trail
      for (const entry of round.participants) {
        if (entry.bye) continue;
        const answers = await QuizTournamentAnswer.findAll({
          where: { roundId: round.id, userId: entry.userId },
          order: [['createdAt', 'ASC']],
          transaction: t
        });
        if (answers.length > 0) {
          entry.completionTime = new Date(answers[answers.length - 1].createdAt) - new Date(answers[0].createdAt);
        } else {
          entry.completionTime = null;
        }
      }
      this._assignRoundRanks(round.participants);
      round.changed('participants', true);
      await round.update({ status: 'completed', completedAt: new Date() }, { transaction: t });
      return false;
    });

    if (alreadyDone) return;

    const round = await QuizTournamentRound.findOne({ where: { tournamentId, roundNumber } });

    // Accumulate cumulative totals + refresh average response time from the
    // full answer history (cheap at tournament scale, always correct).
    for (const entry of round.participants) {
      if (entry.bye) continue;
      const participant = await QuizTournamentParticipant.findOne({ where: { tournamentId, userId: entry.userId } });
      if (!participant || participant.status !== 'active') continue;

      const avgRow = await QuizTournamentAnswer.findOne({
        where: { tournamentId, userId: entry.userId },
        attributes: [[fn('AVG', col('response_time')), 'avgTime']],
        raw: true
      });

      await participant.update({
        totalScore: (participant.totalScore || 0) + (entry.score || 0),
        averageTime: avgRow?.avgTime != null ? parseFloat(avgRow.avgTime) : participant.averageTime
      });
    }

    try {
      require('./websocketManager').broadcastRoundEnded(tournamentId, {
        roundNumber,
        results: round.participants
      });
    } catch (e) {
      console.error('[TournamentService] broadcastRoundEnded failed:', e.message);
    }

    if (tournament.format === 'battle_royale') {
      await this._eliminateBattleRoyaleRound(tournament, round);
    }

    await this._finishRoundAndContinue(tournament, roundNumber, async () => {
      const survivors = await QuizTournamentParticipant.findAll({ where: { tournamentId, status: 'active' } });
      return survivors.map(p => p.userId);
    });
  }

  async _eliminateBattleRoyaleRound(tournament, round) {
    const activeEntries = round.participants.filter(p => !p.bye);
    if (activeEntries.length <= 2) return; // don't eliminate below the final showdown

    const sorted = [...activeEntries].sort((a, b) => (b.score || 0) - (a.score || 0));
    // Same fixed-point problem as startTournament's round-count math: once the
    // field narrows to exactly 3, `Math.floor(3 * 0.25)` is 0, so elimination
    // silently stopped forever short of the "final showdown" the comment
    // above promises. The guard above guarantees sorted.length > 2 here, so
    // Math.min(sorted.length - 2, ...) is always >= 1 — forcing a minimum of
    // 1 elimination per round guarantees the field keeps shrinking toward 2.
    const eliminateCount = Math.max(1, Math.min(sorted.length - 2, Math.floor(sorted.length * 0.25)));
    const toEliminate = sorted.slice(sorted.length - eliminateCount);

    for (const entry of toEliminate) {
      const [updated] = await QuizTournamentParticipant.update(
        { status: 'eliminated', eliminatedAt: new Date() },
        { where: { tournamentId: tournament.id, userId: entry.userId, status: 'active' } }
      );
      // Only announce if this call is the one that actually flipped them —
      // keeps the notice exactly-once if a sweep and a completion race here.
      if (updated > 0) {
        this._announceElimination(tournament.id, entry.userId, round.roundNumber, 'bottom_tier');
      }
    }
  }

  /**
   * Tell a participant (and the tournament room) that they're out. Previously
   * elimination was a silent DB flip, so a knocked-out player sat on the
   * waiting screen indefinitely with no signal from either channel. Sent to the
   * room for live standings and directly to the user for durability — the
   * direct send queues for delivery if they're mid-reconnect, so the client
   * handler must be idempotent. Mirrors how `tournament_ended` is announced.
   */
  _announceElimination(tournamentId, userId, roundNumber, reason) {
    const payload = { tournamentId, userId, roundNumber, reason };
    emitToTournamentRoom(tournamentId, 'participant_eliminated', payload);
    emitToUser(userId, 'participant_eliminated', payload);
  }

  /**
   * Shared tail-end for every round-completion path: bump tournament
   * currentRound + mark non-qualifiers eliminated (via advanceToNextRound),
   * then either move on to the next round or finalize the tournament.
   */
  async _finishRoundAndContinue(tournament, roundNumber, getQualifyingUserIds) {
    const qualifyingUserIds = await getQualifyingUserIds(tournament.id, roundNumber);

    if (roundNumber < tournament.totalRounds) {
      await this.advanceToNextRound(tournament.id, roundNumber, qualifyingUserIds);
    }

    const remainingActive = await QuizTournamentParticipant.count({
      where: { tournamentId: tournament.id, status: 'active' }
    });

    const isFinalRound = roundNumber >= tournament.totalRounds;
    if (isFinalRound || remainingActive <= 1) {
      await this.distributePrizes(tournament.id);
    } else {
      await this.executeRound(tournament.id, roundNumber + 1);
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
      this._announceElimination(tournamentId, participant.userId, currentRoundNumber, 'did_not_qualify');
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
  /**
   * Rank participants for final placement. Knockout and battle_royale are
   * elimination formats — how far you survived (currentRound) outranks raw
   * score, exactly matching standard bracket 3rd-place resolution (the
   * longer-surviving eliminee places above one knocked out earlier).
   * Speed_run ranks "fastest correct completion": only participants who
   * scored anything qualify for time-based ranking at all; zero-score
   * participants (nothing answered correctly) rank last regardless of time.
   * Classic ranks by total score, time as tiebreak.
   */
  _rankParticipants(format, participants) {
    if (format === 'knockout' || format === 'battle_royale') {
      return [...participants].sort((a, b) => {
        if (b.currentRound !== a.currentRound) return b.currentRound - a.currentRound;
        return (b.totalScore || 0) - (a.totalScore || 0);
      });
    }

    if (format === 'speed_run') {
      const scored = participants.filter(p => (p.totalScore || 0) > 0);
      const unscored = participants.filter(p => (p.totalScore || 0) <= 0);
      scored.sort((a, b) => {
        const timeA = a.averageTime == null ? Infinity : parseFloat(a.averageTime);
        const timeB = b.averageTime == null ? Infinity : parseFloat(b.averageTime);
        if (timeA !== timeB) return timeA - timeB;
        return (b.totalScore || 0) - (a.totalScore || 0);
      });
      return [...scored, ...unscored];
    }

    // classic
    return [...participants].sort((a, b) => {
      if ((b.totalScore || 0) !== (a.totalScore || 0)) return (b.totalScore || 0) - (a.totalScore || 0);
      const timeA = a.averageTime == null ? Infinity : parseFloat(a.averageTime);
      const timeB = b.averageTime == null ? Infinity : parseFloat(b.averageTime);
      return timeA - timeB;
    });
  }

  /**
   * Forfeit a participant, called when their socket disconnects and doesn't
   * reconnect within the grace period (see websocketManager's
   * handleReconnectionTimeout). For knockout, forfeits their live match
   * (reusing lobbyService.forfeitMatch — the opponent wins automatically,
   * which flows through onTournamentMatchEnded like a normal finish). For
   * shared-question formats there's no match to forfeit; removing them from
   * the active pool may itself be what was blocking the round from
   * completing, so we re-check that here.
   */
  async forfeitTournament(tournamentId, userId) {
    const tournament = await QuizTournament.findByPk(tournamentId);
    if (!tournament || tournament.status !== 'in_progress') {
      return { success: false, reason: 'not_in_progress' };
    }

    const participant = await QuizTournamentParticipant.findOne({ where: { tournamentId, userId } });
    if (!participant || participant.status !== 'active') {
      return { success: false, reason: 'not_active_participant' };
    }

    await participant.update({ status: 'eliminated', eliminatedAt: new Date() });

    if (tournament.format === 'knockout') {
      const match = await QuizMatch.findOne({
        where: {
          tournamentId,
          status: 'active',
          [Op.or]: [{ challengerId: userId }, { opponentId: userId }]
        }
      });
      if (match) {
        const lobbyService = require('./lobbyService');
        try {
          await lobbyService.forfeitMatch(match.id, userId);
        } catch (err) {
          console.error('[TournamentService] forfeitMatch during tournament forfeit failed:', err.message);
        }
      }
    } else {
      const round = await QuizTournamentRound.findOne({
        where: { tournamentId, roundNumber: tournament.currentRound + 1, status: 'active' }
      });
      if (round) {
        const activeParticipants = await QuizTournamentParticipant.findAll({
          where: { tournamentId, status: 'active' }
        });
        const stillUnfinished = activeParticipants.some(p => {
          const entry = round.participants.find(rp => rp.userId === p.userId);
          return !entry || (entry.answers?.length || 0) < round.questions.length;
        });
        if (activeParticipants.length === 0 || !stillUnfinished) {
          this._completeSharedQuestionRound(tournamentId, round.roundNumber).catch(err => {
            console.error('[TournamentService] _completeSharedQuestionRound after forfeit failed:', err.message);
          });
        }
      }
    }

    emitToTournamentRoom(tournamentId, 'participant_forfeited', { tournamentId, userId });

    return { success: true };
  }

  /**
   * Finalize a tournament and pay out prizes. Idempotent under concurrency:
   * the status flip to 'completed' happens inside a locked transaction
   * first, so if this is somehow triggered twice (e.g. two near-simultaneous
   * final-round completions), the second call sees 'completed' already and
   * returns without a second award pass — this is the single most important
   * guard in the whole engine, since a double-run here would double-pay
   * prizes with real money.
   */
  async distributePrizes(tournamentId) {
    const shouldProceed = await sequelize.transaction(async (t) => {
      const tournament = await QuizTournament.findByPk(tournamentId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!tournament) throw new Error('Tournament not found');
      if (tournament.status === 'completed' || tournament.status === 'cancelled') return false;

      await tournament.update({ status: 'completed', completedAt: new Date() }, { transaction: t });
      return true;
    });

    if (!shouldProceed) {
      return { success: true, alreadyCompleted: true };
    }

    const tournament = await QuizTournament.findByPk(tournamentId);
    const allParticipants = await QuizTournamentParticipant.findAll({ where: { tournamentId } });

    if (allParticipants.length === 0) {
      return { success: true, winnersCount: 0 };
    }

    const ranked = this._rankParticipants(tournament.format, allParticipants).slice(0, 3);

    const prizePool = parseFloat(tournament.prizePool);
    const distribution = tournament.prizeDistribution;
    const prizes = [
      { placement: 1, percentage: distribution.first || 60 },
      { placement: 2, percentage: distribution.second || 30 },
      { placement: 3, percentage: distribution.third || 10 }
    ];

    for (let i = 0; i < ranked.length; i++) {
      const participant = ranked[i];
      const prize = prizes[i];
      const prizeAmount = Math.floor((prizePool * prize.percentage) / 100);

      if (prizeAmount > 0) {
        await quizWalletService.awardTournamentPrize(participant.userId, prizeAmount, tournamentId, prize.placement);
      }

      await participant.update({
        placement: prize.placement,
        prizeWon: prizeAmount,
        status: prize.placement === 1 ? 'winner' : participant.status
      });

      await this.updateUserTournamentStats(participant.userId, tournament, prize.placement, prizeAmount);

      emitToUser(participant.userId, 'tournament_ended', {
        tournamentId,
        placement: prize.placement,
        prizeWon: prizeAmount
      });
    }

    // Every OTHER participant of this now-completed tournament still needs
    // tournamentsEntered incremented — updateUserTournamentStats above only
    // ever runs for the top 3. Before this, the global tournament leaderboard
    // (leaderboardService.getTournamentLeaderboard, filtered on
    // `tournamentsEntered > 0`) permanently excluded every 4th-place-or-lower
    // finisher, forever, no matter how many tournaments they played — the
    // field's only write site was gated on a placement condition its own name
    // says nothing about. `allParticipants` is exactly "everyone who
    // registered and didn't unregister before the tournament started" —
    // unregistering (the only place a participant row is ever deleted) is
    // only permitted while the tournament is still 'open', so by the time
    // this method runs every remaining row genuinely entered and saw it
    // through. This intentionally updates ONLY tournamentsEntered, not
    // tournamentsWon/top3Finishes/prize fields — those remain placement-only,
    // exactly as they already correctly are.
    const rankedUserIds = new Set(ranked.map(p => p.userId));
    for (const participant of allParticipants) {
      if (rankedUserIds.has(participant.userId)) continue; // already handled above
      await this._incrementTournamentsEntered(participant.userId);
    }

    // Every stat write above just landed in UserQuizStats.tournamentStats, but
    // the global Leaderboard page (leaderboardService.getGlobalLeaderboard /
    // getTournamentLeaderboard) serves those numbers from a 5-minute Redis
    // cache. Nothing previously invalidated it here — the only refresh was a
    // blanket cron every 5 minutes — so a tournament could finish, stats could
    // be correct in the database, and the Leaderboard page would still show
    // stale pre-completion numbers for up to 5 minutes. 'all' covers both the
    // Tournament tab and the Global tab, since the latter's ranking also
    // factors in tournament_stats->>'totalPrizeMoney'.
    try {
      await require('./leaderboardService').invalidateCache('all');
    } catch (e) {
      console.error('[TournamentService] Leaderboard cache invalidation failed:', e.message);
    }

    try {
      require('./websocketManager').broadcastTournamentEnded(tournamentId, {
        winnerId: ranked[0]?.userId || null,
        placements: ranked.map((p, i) => ({ userId: p.userId, placement: i + 1, prizeWon: prizes[i] ? Math.floor((prizePool * prizes[i].percentage) / 100) : 0 }))
      });
    } catch (e) {
      console.error('[TournamentService] broadcastTournamentEnded failed:', e.message);
    }

    return { success: true, winnersCount: ranked.length };
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
   * Increment only tournamentsEntered, for a participant of a just-completed
   * tournament who did not place top 3. Kept separate from
   * updateUserTournamentStats (rather than calling it with a null placement)
   * so a non-placer's update carries none of the placement-specific side
   * effects — tournamentsWon, top3Finishes, and the prize/entry-fee/netProfit
   * fields stay exactly as accurate as they already are for top-3 finishers,
   * untouched by this.
   */
  async _incrementTournamentsEntered(userId) {
    const [stats] = await UserQuizStats.findOrCreate({
      where: { userId },
      defaults: { userId }
    });

    const tournamentStats = stats.tournamentStats || {};
    tournamentStats.tournamentsEntered = (tournamentStats.tournamentsEntered || 0) + 1;

    await stats.update({
      tournamentStats,
      lastTournamentAt: new Date()
    });
  }

/** Attach categoryName + currentParticipants to a plain tournament object (mutates and returns it). */
  async _enrichTournament(tournamentJson) {
    const QuizCategory = require('../models/QuizCategory');
    const [category, currentParticipants] = await Promise.all([
      tournamentJson.categoryId ? QuizCategory.findByPk(tournamentJson.categoryId, { attributes: ['name'] }) : null,
      QuizTournamentParticipant.count({ where: { tournamentId: tournamentJson.id } })
    ]);
    tournamentJson.categoryName = category?.name || null;
    tournamentJson.currentParticipants = currentParticipants;
    return tournamentJson;
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
   * Public tournament listing — deliberately never surfaces 'draft',
   * 'pending_review', or 'rejected' tournaments (unapproved proposals and
   * admin drafts aren't other users' business). Admins reviewing proposals
   * use listProposals() instead.
   */
  async getTournaments(options = {}) {
    const PUBLIC_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
    const { status, format, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const where = {};
    where.status = (status && PUBLIC_STATUSES.includes(status)) ? status : { [Op.in]: PUBLIC_STATUSES };
    if (format) where.format = format;

    const { count, rows } = await QuizTournament.findAndCountAll({
      where,
      limit,
      offset,
      order: [['startTime', 'ASC']]
    });

    const tournaments = await Promise.all(rows.map(r => this._enrichTournament(r.toJSON())));

    return {
      tournaments,
      totalCount: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  /**
   * Get tournament leaderboard — enriches each participant with their quiz
   * nickname/avatar (not stored on QuizTournamentParticipant itself) and a
   * live 1-indexed rank (distinct from `placement`, which stays null until
   * the tournament actually finishes and prizes are paid out).
   */
  async getTournamentLeaderboard(tournamentId) {
    const tournament = await QuizTournament.findByPk(tournamentId);

    if (!tournament) {
      throw new Error('Tournament not found');
    }

    const participants = await QuizTournamentParticipant.findAll({ where: { tournamentId } });
    const rankedInstances = this._rankParticipants(tournament.format, participants);

    const statsRows = await UserQuizStats.findAll({
      where: { userId: rankedInstances.map(p => p.userId) },
      attributes: ['userId', 'nickname', 'avatarUrl']
    });
    const statsMap = {};
    statsRows.forEach(s => { statsMap[s.userId] = s; });

    const ranked = rankedInstances.map((p, index) => ({
      ...p.toJSON(),
      rank: index + 1,
      nickname: statsMap[p.userId]?.nickname || `Player_${p.userId}`,
      avatarUrl: statsMap[p.userId]?.avatarUrl || null
    }));

    return {
      participants: ranked,
      currentRound: tournament.currentRound,
      totalRounds: tournament.totalRounds,
      status: tournament.status
    };
  }

  // =======================================================================
  // Lifecycle automation — called by cron (see server.js setupQuizScheduledTasks)
  // =======================================================================

  /**
   * Registration-deadline and start-time driven transitions. Runs
   * frequently (every minute, matching the existing lobby-challenge-expiry
   * cron cadence) so the gap between "should have started" and "actually
   * started" stays small. Every tournament is handled independently and
   * wrapped in try/catch so one bad tournament can't block the rest.
   */
  async runLifecycleSweep() {
    const now = new Date();

    // Past registration deadline but before start time, still under-filled —
    // refund early instead of making registered players wait until start
    // time only to find out it's cancelled.
    const pastDeadline = await QuizTournament.findAll({
      where: {
        status: 'open',
        registrationDeadline: { [Op.lte]: now },
        startTime: { [Op.gt]: now }
      }
    });

    for (const tournament of pastDeadline) {
      try {
        const count = await QuizTournamentParticipant.count({
          where: { tournamentId: tournament.id, status: 'registered' }
        });
        if (count < tournament.minParticipants) {
          await this.handleInsufficientParticipants(tournament.id, true);
          console.log(`[TournamentService] Auto-cancelled under-filled tournament ${tournament.id} (${count}/${tournament.minParticipants})`);
        }
      } catch (err) {
        console.error(`[TournamentService] Lifecycle sweep (deadline) failed for ${tournament.id}:`, err.message);
      }
    }

    // Past start time and still open — start it, or cancel if it never
    // filled (covers tournaments with no admin-set registration deadline
    // gap, or ones that dropped below minParticipants via unregistration
    // after the deadline check above already ran).
    const dueToStart = await QuizTournament.findAll({
      where: { status: 'open', startTime: { [Op.lte]: now } }
    });

    for (const tournament of dueToStart) {
      try {
        const count = await QuizTournamentParticipant.count({
          where: { tournamentId: tournament.id, status: 'registered' }
        });
        if (count >= tournament.minParticipants) {
          await this.startTournament(tournament.id);
          console.log(`[TournamentService] Auto-started tournament ${tournament.id} (${count} participants)`);
        } else {
          await this.handleInsufficientParticipants(tournament.id, true);
          console.log(`[TournamentService] Auto-cancelled under-filled tournament ${tournament.id} at start time (${count}/${tournament.minParticipants})`);
        }
      } catch (err) {
        console.error(`[TournamentService] Lifecycle sweep (start) failed for ${tournament.id}:`, err.message);
      }
    }
  }

  /**
   * Safety net for shared-question-set rounds (classic/speed_run/battle_royale)
   * where one or more participants went AFK without disconnecting (so no
   * socket-disconnect forfeit ever fires). Force-submits 'timeout' for any
   * question they never answered, which naturally drives the round to
   * completion through the same path a real answer would. Knockout isn't
   * swept here — its matches already rely on the same client-side 12s
   * auto-timeout and disconnect-triggered forfeit the 1v1 lobby uses.
   */
  async sweepStaleRounds() {
    const cutoff = new Date(Date.now() - ROUND_MAX_DURATION_MS);
    const staleRounds = await QuizTournamentRound.findAll({
      where: { status: 'active', startedAt: { [Op.lt]: cutoff } }
    });

    for (const round of staleRounds) {
      try {
        const tournament = await QuizTournament.findByPk(round.tournamentId);
        if (!tournament || tournament.format === 'knockout') continue;

        const activeParticipants = await QuizTournamentParticipant.findAll({
          where: { tournamentId: round.tournamentId, status: 'active' }
        });

        for (const participant of activeParticipants) {
          const entry = round.participants.find(p => p.userId === participant.userId);
          const answeredIds = new Set(entry?.answers || []);
          const missing = round.questions.filter(qId => !answeredIds.has(qId));

          for (const questionId of missing) {
            try {
              await this.submitAnswer(round.tournamentId, round.roundNumber, participant.userId, questionId, 'timeout', Date.now());
            } catch (err) {
              // Already answered / round no longer active by the time we got here — non-fatal
            }
          }
        }
        console.log(`[TournamentService] Swept stale round ${round.id} (tournament ${round.tournamentId}, round ${round.roundNumber})`);
      } catch (err) {
        console.error(`[TournamentService] sweepStaleRounds failed for round ${round.id}:`, err.message);
      }
    }
  }

  /**
   * Safety net for knockout matches with a silent opponent. Knockout matches
   * have no accept/decline step, so a no-show leaves the match 'active'
   * forever — which blocks the whole round (and thus the whole bracket),
   * since round-advance requires every match in the round to reach
   * 'completed'. `match.participants[].answers` (kept in sync with
   * QuizMatchAnswer by lobbyService.submitAnswer) is the signal used to tell
   * "present but slow" from "never showed up" — no extra table/join needed.
   *
   * One side silent past the grace period -> auto-forfeit them via the
   * existing lobbyService.forfeitMatch, which already handles winner
   * assignment, match completion, and triggers the normal round-advance
   * path (onTournamentMatchEnded). Both sides silent past a longer window ->
   * neither "deserves" the win, so the match is closed out directly with no
   * winner; onTournamentMatchEnded already treats a null winnerId as
   * non-qualifying, so neither side advances.
   */
  async sweepStaleKnockoutMatches() {
    const graceCutoff = new Date(Date.now() - KNOCKOUT_NO_SHOW_GRACE_MS);
    const staleMatches = await QuizMatch.findAll({
      where: { matchType: 'tournament', status: 'active', createdAt: { [Op.lt]: graceCutoff } }
    });

    const bothAbsentCutoff = new Date(Date.now() - KNOCKOUT_BOTH_ABSENT_GRACE_MS);

    for (const match of staleMatches) {
      try {
        const [p1, p2] = match.participants || [];
        if (!p1 || !p2) continue;

        const p1Answered = (p1.answers || []).length > 0;
        const p2Answered = (p2.answers || []).length > 0;

        if (p1Answered && p2Answered) continue; // both active, not stuck

        if (p1Answered !== p2Answered) {
          // Exactly one side is silent — forfeit them.
          const absentUserId = p1Answered ? p2.userId : p1.userId;
          await require('./lobbyService').forfeitMatch(match.id, absentUserId);
          console.log(`[TournamentService] Auto-forfeited no-show user ${absentUserId} in knockout match ${match.id}`);
          continue;
        }

        // Neither side has answered anything — only close it out once the
        // longer both-absent window has elapsed, to avoid punishing a match
        // where both players are just slow to start.
        if (match.createdAt > bothAbsentCutoff) continue;

        match.changed('participants', true);
        await match.update({ winnerId: null, status: 'completed', completedAt: new Date() });
        console.log(`[TournamentService] Closed out both-absent knockout match ${match.id} with no winner`);

        setTimeout(() => {
          this.onTournamentMatchEnded(match).catch(err => {
            console.error('[TournamentService] onTournamentMatchEnded (both-absent) failed:', err.message);
          });
        }, 0);
      } catch (err) {
        console.error(`[TournamentService] sweepStaleKnockoutMatches failed for match ${match.id}:`, err.message);
      }
    }
  }

  /**
   * Safety net for a tournament stuck in 'in_progress' with no round 1 —
   * startTournament()'s status-flip transaction can commit successfully and
   * then the subsequent executeRound(id, 1) call can throw, leaving the
   * tournament with no round record at all and nothing to ever revisit it
   * automatically. Retrying is safe: executeRound is idempotent (unique
   * constraint on tournamentId+roundNumber, treated as a no-op if the round
   * already exists).
   *
   * Filtered on "has zero rows in `rounds` at all", not `currentRound: 0` —
   * currentRound only advances at the END of round 1 (see
   * advanceToNextRound), so it reads 0 for that round's entire, often
   * multi-minute duration, not just the brief pre-creation gap this sweep
   * targets. Using round existence instead means a tournament only ever
   * matches this query once, for real: as soon as round 1 exists (whether
   * from the original call or this retry), it's excluded from every future
   * tick for the rest of its lifetime — not just re-checked-and-skipped.
   */
  async sweepStuckTournamentStarts() {
    const cutoff = new Date(Date.now() - STUCK_START_GRACE_MS);
    const stuck = await QuizTournament.findAll({
      where: { status: 'in_progress', updatedAt: { [Op.lt]: cutoff } },
      include: [{ model: QuizTournamentRound, as: 'rounds', attributes: ['id'], required: false }]
    });

    for (const tournament of stuck) {
      if (tournament.rounds && tournament.rounds.length > 0) continue; // has at least round 1 — healthy, just mid-round

      try {
        console.warn(`[TournamentService] Retrying stuck round-1 start for tournament ${tournament.id}`);
        await this.executeRound(tournament.id, 1);
      } catch (err) {
        console.error(`[TournamentService] sweepStuckTournamentStarts retry failed for tournament ${tournament.id}:`, err.message);
      }
    }
  }

  /**
   * "Where do I join right now?" — the persistent, pollable counterpart to
   * the one-shot 'challenge_accepted'/'round_started' socket pushes. Lets the
   * frontend always show a registrant their active tournament match/round
   * even if they missed the live push entirely (reload, reconnect, backgrounded
   * tab, etc). Deliberately does not touch or reuse lobbyService's
   * getActiveMatchForUser (that stays scoped to the shared 1v1 engine) — this
   * is a tournament-only read filtered to matchType:'tournament'.
   */
  async getMyActiveTournamentPlay(userId) {
    const matchCutoff = new Date(Date.now() - ACTIVE_MATCH_LOOKBACK_MS);
    const match = await QuizMatch.findOne({
      where: {
        matchType: 'tournament',
        status: 'active',
        createdAt: { [Op.gte]: matchCutoff },
        participants: { [Op.contains]: [{ userId }] }
      },
      order: [['createdAt', 'DESC']]
    });

    if (match) {
      const payload = await require('./lobbyService').buildChallengeAcceptPayload(match, userId);
      // Null means the match has no real opponent to play against, so there's
      // nothing joinable to advertise — spreading it would yield a
      // knockout_match with no matchId and send the "Join Now" banner nowhere.
      if (payload) {
        return {
          type: 'knockout_match',
          tournamentId: match.tournamentId,
          roundNumber: match.roundNumber,
          ...payload
        };
      }
    }

    const participant = await QuizTournamentParticipant.findOne({
      where: { userId, status: 'active' }
    });

    if (participant) {
      const round = await QuizTournamentRound.findOne({
        where: { tournamentId: participant.tournamentId, status: 'active' }
      });

      if (round) {
        const myEntry = round.participants.find(p => p.userId === userId);
        const finished = myEntry && (myEntry.answers || []).length >= round.questions.length;
        if (myEntry && !finished && !myEntry.bye) {
          const tournament = await QuizTournament.findByPk(participant.tournamentId, {
            attributes: ['id', 'name', 'format']
          });
          return {
            type: 'shared_round',
            tournamentId: round.tournamentId,
            tournamentName: tournament?.name || null,
            format: tournament?.format || null,
            roundNumber: round.roundNumber
          };
        }
      }
    }

    return { type: 'none' };
  }
}

module.exports = new TournamentService();
