const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const lobbyService = require('./lobbyService');
const activeUserTracker = require('./activeUserTracker');
const quizRateLimiter = require('../middleware/quizRateLimiter');

/**
 * WebSocket Manager
 * 
 * Manages real-time communication for quiz matches and tournaments
 * Features:
 * - Authentication
 * - Room-based messaging
 * - Heartbeat monitoring
 * - Reconnection handling
 * - Match and tournament events
 * - Active user tracking
 */

class WebSocketManager {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> { socketId, lastHeartbeat }
    this.userSockets = new Map(); // socketId -> userId
    this.matchRooms = new Map(); // matchId -> Set of socketIds
    this.tournamentRooms = new Map(); // tournamentId -> Set of socketIds
    this.disconnectedUsers = new Map(); // userId -> { disconnectedAt, matchId, tournamentId }
    this.reconnectionTimers = new Map(); // userId -> timeoutId
    this.pendingEvents = new Map(); // userId -> Array of { event, payload } to emit on reconnect
    this.RECONNECTION_GRACE_PERIOD = 60000; // 60 seconds — generous for mobile users
  }

  /**
   * Initialize Socket.io server
   * 
   * @param {Object} server - HTTP server instance
   */
  initialize(server) {
    this.io = socketIO(server, {
      cors: {
        origin: [
          'https://www.hallos.net',
          'https://hallos.net',
          'https://www.quiz.hallos.net',
          'http://localhost:3000',
          'http://localhost:3001'
        ],
        credentials: true,
        methods: ['GET', 'POST']
      },
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        socket.userId = Number(decoded.id || decoded.userId);
        socket.user = decoded;

        next();
      } catch (error) {
        console.error('[WebSocket] Authentication error:', error.message);
        next(new Error('Invalid token'));
      }
    });

    // Connection handler
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    // Start heartbeat monitor
    this.startHeartbeatMonitor();

    console.log('✅ WebSocket Manager initialized');
  }

  /**
   * Handle new socket connection
   */
  handleConnection(socket) {
    const userId = socket.userId;
    console.log(`[WebSocket] User ${userId} connected (${socket.id})`);

    // Check if user is reconnecting
    if (this.disconnectedUsers.has(userId)) {
      this.handleReconnection(socket, userId);
      return;
    }

    // Store connection
    this.connectedUsers.set(userId, {
      socketId: socket.id,
      lastHeartbeat: Date.now()
    });
    this.userSockets.set(socket.id, userId);

    // Mark user as active in Redis
    activeUserTracker.markUserActive(userId).catch(err => {
      console.error(`[WebSocket] Error marking user ${userId} active:`, err.message);
    });

    // Notify all clients that player list changed
    setTimeout(() => this.broadcastPlayersUpdated(), 200);

    // Send authentication confirmation
    socket.emit('authenticated', {
      userId,
      socketId: socket.id,
      timestamp: Date.now()
    });

    // Flush any queued events (e.g. challenge_accepted that was missed)
    this.flushPendingEvents(userId, socket);
    this.registerMatchEvents(socket);
    this.registerTournamentEvents(socket);
    this.registerHeartbeatEvents(socket);
    this.registerActiveUserEvents(socket);

    // Check for active matches in DB to handle full page reloads/new sessions
    this.resyncActiveMatch(socket, userId);

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  /**
   * Handle user reconnection
   */
  handleReconnection(socket, userId) {
    console.log(`[WebSocket] User ${userId} reconnecting (${socket.id})`);

    const disconnectInfo = this.disconnectedUsers.get(userId);
    
    // Clear reconnection timer
    if (this.reconnectionTimers.has(userId)) {
      clearTimeout(this.reconnectionTimers.get(userId));
      this.reconnectionTimers.delete(userId);
    }

    // Remove from disconnected users
    this.disconnectedUsers.delete(userId);

    // Restore connection
    this.connectedUsers.set(userId, {
      socketId: socket.id,
      lastHeartbeat: Date.now()
    });
    this.userSockets.set(socket.id, userId);

    // Mark user as active in Redis
    activeUserTracker.markUserActive(userId).catch(err => {
      console.error(`[WebSocket] Error marking user ${userId} active:`, err.message);
    });

    // Send reconnection confirmation
    socket.emit('reconnected', {
      userId,
      socketId: socket.id,
      timestamp: Date.now(),
      matchId: disconnectInfo?.matchId,
      tournamentId: disconnectInfo?.tournamentId
    });

    // Flush any queued events (e.g. challenge_accepted that was missed)
    this.flushPendingEvents(userId, socket);

    // Rejoin rooms if applicable
    if (disconnectInfo?.matchId) {
      socket.join(`match:${disconnectInfo.matchId}`);
      
      if (!this.matchRooms.has(disconnectInfo.matchId)) {
        this.matchRooms.set(disconnectInfo.matchId, new Set());
      }
      this.matchRooms.get(disconnectInfo.matchId).add(socket.id);

      // Notify about reconnection
      socket.emit('match_state_restored', {
        matchId: disconnectInfo.matchId,
        message: 'You have been reconnected to the match'
      });
    }

    if (disconnectInfo?.tournamentId) {
      socket.join(`tournament:${disconnectInfo.tournamentId}`);
      
      if (!this.tournamentRooms.has(disconnectInfo.tournamentId)) {
        this.tournamentRooms.set(disconnectInfo.tournamentId, new Set());
      }
      this.tournamentRooms.get(disconnectInfo.tournamentId).add(socket.id);

      // Notify about reconnection
      socket.emit('tournament_state_restored', {
        tournamentId: disconnectInfo.tournamentId,
        message: 'You have been reconnected to the tournament'
      });
    }

    // Register event handlers
    this.registerMatchEvents(socket);
    this.registerTournamentEvents(socket);
    this.registerHeartbeatEvents(socket);
    this.registerActiveUserEvents(socket);

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });

    console.log(`[WebSocket] User ${userId} successfully reconnected`);
  }

  /**
   * Register match-related events
   */
  registerMatchEvents(socket) {
    const userId = socket.userId;

    // Join match room
    socket.on('join_match', async (data) => {
      try {
        const { matchId } = data;

        // Verify user is participant
        const match = await lobbyService.getMatch(matchId);
        const isParticipant = match.participants.some(p => p.userId === userId);

        if (!isParticipant) {
          socket.emit('error', {
            code: 'FORBIDDEN',
            message: 'You are not a participant in this match'
          });
          return;
        }

        // Join room
        socket.join(`match:${matchId}`);
        
        if (!this.matchRooms.has(matchId)) {
          this.matchRooms.set(matchId, new Set());
        }
        this.matchRooms.get(matchId).add(socket.id);

        socket.emit('match_joined', {
          matchId,
          timestamp: Date.now()
        });

        console.log(`[WebSocket] User ${userId} joined match ${matchId}`);
      } catch (error) {
        console.error('[WebSocket] Join match error:', error);
        socket.emit('error', {
          code: 'JOIN_MATCH_ERROR',
          message: error.message
        });
      }
    });

    // Submit answer
    socket.on('submit_answer', async (data) => {
      try {
        const { matchId, questionId } = data;

        // Normalize field names — frontend sends 'answer', backend uses 'answerId'
        const answerId = data.answerId || data.answer;

        // Normalize timestamp — frontend sends 'timeInSeconds', backend uses 'clientTimestamp' (ms)
        const clientTimestamp = data.clientTimestamp ||
          Math.floor(data.timeInSeconds !== undefined ? Date.now() - (data.timeInSeconds * 1000) : Date.now());

        // Rate limiting check
        const limitRes = await quizRateLimiter.checkLimit(`quiz:ratelimit:answer:${userId}`, 30, 10);
        console.log(`[QuizWS] Answer Submission - User: ${userId}, Allowed: ${limitRes.allowed}`);
        if (!limitRes.allowed) {
          socket.emit('error', {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many answer submissions. Please slow down.',
            retryAfter: limitRes.retryAfter
          });
          return;
        }

        // Submit answer via service
        const result = await lobbyService.submitAnswer(
          matchId,
          userId,
          questionId,
          answerId,
          clientTimestamp
        );

        // Confirm to sender with full result
        socket.emit('answer_recorded', {
          questionId,
          success: result.success,
          correct: result.correct,
          correctAnswer: result.correctAnswer,
          pointsEarned: result.pointsEarned,
          responseTime: result.responseTime
        });

        console.log(`[WebSocket] User ${userId} answered question ${questionId} in match ${matchId}`);
      } catch (error) {
        console.error('[WebSocket] Submit answer error:', error);
        socket.emit('error', {
          code: 'SUBMIT_ANSWER_ERROR',
          message: error.message
        });
      }
    });

    // Leave match room
    socket.on('leave_match', (data) => {
      const { matchId } = data;
      socket.leave(`match:${matchId}`);
      
      if (this.matchRooms.has(matchId)) {
        this.matchRooms.get(matchId).delete(socket.id);
      }

      console.log(`[WebSocket] User ${userId} left match ${matchId}`);
    });
  }

  /**
   * Register tournament-related events
   */
  registerTournamentEvents(socket) {
    const userId = socket.userId;

    // Join tournament room
    socket.on('join_tournament', async (data) => {
      try {
        const { tournamentId } = data;

        // Join room
        socket.join(`tournament:${tournamentId}`);
        
        if (!this.tournamentRooms.has(tournamentId)) {
          this.tournamentRooms.set(tournamentId, new Set());
        }
        this.tournamentRooms.get(tournamentId).add(socket.id);

        socket.emit('tournament_joined', {
          tournamentId,
          timestamp: Date.now()
        });

        console.log(`[WebSocket] User ${userId} joined tournament ${tournamentId}`);
      } catch (error) {
        console.error('[WebSocket] Join tournament error:', error);
        socket.emit('error', {
          code: 'JOIN_TOURNAMENT_ERROR',
          message: error.message
        });
      }
    });

    // Submit tournament answer
    socket.on('submit_tournament_answer', async (data) => {
      try {
        const { tournamentId, roundNumber, questionId, answerId, clientTimestamp } = data;

        // Rate limiting check
        const limitRes = await quizRateLimiter.checkLimit(`quiz:ratelimit:answer:${userId}`, 30, 10);
        console.log(`[QuizWS] Tournament Answer - User: ${userId}, Allowed: ${limitRes.allowed}`);
        if (!limitRes.allowed) {
          socket.emit('error', {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many answer submissions. Please slow down.',
            retryAfter: limitRes.retryAfter
          });
          return;
        }

        // TODO: Implement tournament answer submission
        // This would be similar to match answer submission but for tournaments

        socket.emit('tournament_answer_recorded', {
          questionId,
          success: true
        });

        console.log(`[WebSocket] User ${userId} answered tournament question`);
      } catch (error) {
        console.error('[WebSocket] Submit tournament answer error:', error);
        socket.emit('error', {
          code: 'SUBMIT_TOURNAMENT_ANSWER_ERROR',
          message: error.message
        });
      }
    });

    // Leave tournament room
    socket.on('leave_tournament', (data) => {
      const { tournamentId } = data;
      socket.leave(`tournament:${tournamentId}`);
      
      if (this.tournamentRooms.has(tournamentId)) {
        this.tournamentRooms.get(tournamentId).delete(socket.id);
      }

      console.log(`[WebSocket] User ${userId} left tournament ${tournamentId}`);
    });
  }

  /**
   * Register heartbeat events
   */
  registerHeartbeatEvents(socket) {
    const userId = socket.userId;

    socket.on('heartbeat', (data) => {
      const serverTime = Date.now();
      const clientTime = data.timestamp;
      const latency = serverTime - clientTime;

      // Update last heartbeat
      if (this.connectedUsers.has(userId)) {
        this.connectedUsers.get(userId).lastHeartbeat = serverTime;
      }

      // Mark user as active in Redis
      activeUserTracker.markUserActive(userId).catch(err => {
        console.error(`[WebSocket] Error marking user ${userId} active:`, err.message);
      });

      // Send acknowledgment
      socket.emit('heartbeat_ack', {
        serverTime,
        latency
      });

      // Warn if high latency
      if (latency > 500) {
        socket.emit('connection_warning', {
          latency,
          message: 'High latency detected. Your connection may be unstable.'
        });
      }
    });
  }

  /**
   * Register active user tracking events
   */
  registerActiveUserEvents(socket) {
    const userId = socket.userId;

    // User activity ping (when user interacts with quiz screen)
    socket.on('user_activity', async () => {
      try {
        await activeUserTracker.markUserActive(userId);
      } catch (error) {
        console.error(`[WebSocket] Error handling user activity for ${userId}:`, error.message);
      }
    });

    // Request active user count
    socket.on('get_active_users', async () => {
      try {
        const count = await activeUserTracker.getActiveUserCount();
        socket.emit('active_users_update', {
          count,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error('[WebSocket] Error getting active users:', error.message);
        socket.emit('error', {
          code: 'ACTIVE_USERS_ERROR',
          message: 'Failed to get active user count'
        });
      }
    });

    // Request online players list (for Players screen)
    socket.on('get_online_players', async (data) => {
      try {
        const page = parseInt(data?.page) || 1;
        const limit = parseInt(data?.limit) || 12;
        const players = await this.getOnlinePlayers(userId, page, limit);
        socket.emit('online_players', players);
      } catch (error) {
        console.error('[WebSocket] Error getting online players:', error.message);
        socket.emit('error', {
          code: 'ONLINE_PLAYERS_ERROR',
          message: 'Failed to get online players'
        });
      }
    });
  }

  /**
   * Fetch paginated online players enriched with quiz stats
   * Excludes the requesting user
   * @param {number} requestingUserId - The user making the request (excluded from results)
   * @param {number} page
   * @param {number} limit
   */
  async getOnlinePlayers(requestingUserId, page = 1, limit = 12) {
    const UserQuizStats = require('../models/UserQuizStats');
    const quizWalletService = require('./quizWalletService');
    const { Op } = require('sequelize');

    const allActiveIds = await activeUserTracker.getActiveUserIds();

    // Exclude the requesting user
    const otherIds = allActiveIds.filter(id => id !== requestingUserId);
    const total = otherIds.length;

    // Paginate the IDs
    const offset = (page - 1) * limit;
    const pageIds = otherIds.slice(offset, offset + limit);

    if (pageIds.length === 0) {
      return { players: [], total, page, totalPages: Math.ceil(total / limit) };
    }

    // Fetch quiz stats + nickname + avatar for these users
    const stats = await UserQuizStats.findAll({
      where: { userId: { [Op.in]: pageIds } },
      attributes: ['userId', 'nickname', 'avatarUrl', 'lobbyStats']
    });

    const statsMap = {};
    stats.forEach(s => { statsMap[s.userId] = s; });

    // Fetch balances for all players in parallel
    const balances = await Promise.all(
      pageIds.map(id => quizWalletService.getBalance(id).catch(() => 0))
    );

    const players = pageIds.map((id, index) => {
      const s = statsMap[id];
      const lobbyStats = s?.lobbyStats || {};
      return {
        userId: id,
        nickname: s?.nickname || `Player_${id}`,
        avatarUrl: s?.avatarUrl || null,
        chutaBalance: balances[index] || 0,
        wins: lobbyStats.wins || 0,
        losses: lobbyStats.losses || 0,
        winRate: lobbyStats.winRate || 0,
        totalWinnings: lobbyStats.totalWinnings || 0,
        isOnline: true
      };
    });

    return { players, total, page, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Handle socket disconnection
   */
  handleDisconnection(socket) {
    const userId = socket.userId;
    console.log(`[WebSocket] User ${userId} disconnected (${socket.id})`);

    // Check if user is in an active match or tournament
    let matchId = null;
    let tournamentId = null;

    // Find match room
    for (const [mId, sockets] of this.matchRooms.entries()) {
      if (sockets.has(socket.id)) {
        matchId = mId;
        break;
      }
    }

    // Find tournament room
    for (const [tId, sockets] of this.tournamentRooms.entries()) {
      if (sockets.has(socket.id)) {
        tournamentId = tId;
        break;
      }
    }

    // If user is in active match/tournament, start reconnection grace period
    if (matchId || tournamentId) {
      console.log(`[WebSocket] User ${userId} disconnected from active game. Starting ${this.RECONNECTION_GRACE_PERIOD / 1000}s grace period...`);

      // Store disconnection info
      this.disconnectedUsers.set(userId, {
        disconnectedAt: Date.now(),
        matchId,
        tournamentId,
        socketId: socket.id
      });

      // Set reconnection timer
      const timerId = setTimeout(() => {
        this.handleReconnectionTimeout(userId, matchId, tournamentId);
      }, this.RECONNECTION_GRACE_PERIOD);

      this.reconnectionTimers.set(userId, timerId);

      // Notify other participants
      if (matchId) {
        this.io.to(`match:${matchId}`).emit('opponent_disconnected', {
          userId,
          reconnectionDeadline: Date.now() + this.RECONNECTION_GRACE_PERIOD
        });
      }

      if (tournamentId) {
        this.io.to(`tournament:${tournamentId}`).emit('participant_disconnected', {
          userId,
          reconnectionDeadline: Date.now() + this.RECONNECTION_GRACE_PERIOD
        });
      }
    }

    // Remove from tracking
    this.connectedUsers.delete(userId);
    this.userSockets.delete(socket.id);

    // Mark user as inactive in Redis (only if not in grace period)
    if (!matchId && !tournamentId) {
      activeUserTracker.markUserInactive(userId).catch(err => {
        console.error(`[WebSocket] Error marking user ${userId} inactive:`, err.message);
      });
      // Notify all clients that player list changed
      setTimeout(() => this.broadcastPlayersUpdated(), 200);
    }

    // Remove from all rooms
    this.matchRooms.forEach((sockets, matchId) => {
      sockets.delete(socket.id);
    });
    this.tournamentRooms.forEach((sockets, tournamentId) => {
      sockets.delete(socket.id);
    });
  }

  /**
   * Handle reconnection timeout (forfeit)
   */
  async handleReconnectionTimeout(userId, matchId, tournamentId) {
    console.log(`[WebSocket] User ${userId} failed to reconnect within grace period. Forfeiting...`);

    // Remove from disconnected users
    this.disconnectedUsers.delete(userId);
    this.reconnectionTimers.delete(userId);

    // Mark user as inactive
    activeUserTracker.markUserInactive(userId).catch(err => {
      console.error(`[WebSocket] Error marking user ${userId} inactive:`, err.message);
    });

    // Forfeit match if applicable
    if (matchId) {
      try {
        const lobbyService = require('./lobbyService');
        await lobbyService.forfeitMatch(matchId, userId);

        // Notify other participants
        this.io.to(`match:${matchId}`).emit('opponent_forfeited', {
          userId,
          reason: 'Failed to reconnect',
          timestamp: Date.now()
        });

        console.log(`[WebSocket] User ${userId} forfeited match ${matchId} due to disconnect`);
      } catch (error) {
        console.error(`[WebSocket] Error forfeiting match for user ${userId}:`, error.message);
      }
    }

    // Handle tournament forfeit if applicable
    if (tournamentId) {
      try {
        // TODO: Implement tournament forfeit logic
        // const tournamentService = require('./tournamentService');
        // await tournamentService.forfeitTournament(tournamentId, userId);

        // Notify other participants
        this.io.to(`tournament:${tournamentId}`).emit('participant_forfeited', {
          userId,
          reason: 'Failed to reconnect',
          timestamp: Date.now()
        });

        console.log(`[WebSocket] User ${userId} forfeited tournament ${tournamentId} due to disconnect`);
      } catch (error) {
        console.error(`[WebSocket] Error forfeiting tournament for user ${userId}:`, error.message);
      }
    }
  }

  /**
   * Start heartbeat monitor
   * Checks for stale connections every 30 seconds
   */
  startHeartbeatMonitor() {
    setInterval(() => {
      const now = Date.now();
      const timeout = 120000; // 2 minutes — generous enough for active gameplay

      this.connectedUsers.forEach((connection, userId) => {
        const timeSinceHeartbeat = now - connection.lastHeartbeat;

        if (timeSinceHeartbeat > timeout) {
          console.log(`[WebSocket] User ${userId} connection timeout`);
          
          // Disconnect stale connection
          const socket = this.io.sockets.sockets.get(connection.socketId);
          if (socket) {
            socket.disconnect(true);
          }
        }
      });
    }, 30000);
  }

  /**
   * Broadcast that the online players list has changed
   * Frontend should re-fetch or update its current page
   */
  broadcastPlayersUpdated() {
    if (!this.io) return;
    activeUserTracker.getActiveUserCount().then(count => {
      this.io.emit('players_updated', {
        onlineCount: count,
        timestamp: Date.now()
      });
    }).catch(() => {});
  }

  /**
   * Broadcast match started event
   */
  broadcastMatchStarted(matchId, data) {
    this.io.to(`match:${matchId}`).emit('match_started', {
      matchId,
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast match ended event
   */
  broadcastMatchEnded(matchId, data) {
    this.io.to(`match:${matchId}`).emit('match_ended', {
      matchId,
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast tournament started event
   */
  broadcastTournamentStarted(tournamentId, data) {
    this.io.to(`tournament:${tournamentId}`).emit('tournament_started', {
      tournamentId,
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast tournament round ended event
   */
  broadcastRoundEnded(tournamentId, data) {
    this.io.to(`tournament:${tournamentId}`).emit('round_ended', {
      tournamentId,
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast tournament ended event
   */
  broadcastTournamentEnded(tournamentId, data) {
    this.io.to(`tournament:${tournamentId}`).emit('tournament_ended', {
      tournamentId,
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * Send event to user immediately if connected, or queue it for when they reconnect
   */
  sendOrQueue(userId, event, payload) {
    const normalizedId = Number(userId);
    const socket = this.getUserSocket(normalizedId);
    if (socket) {
      socket.emit(event, payload);
      console.log(`[WebSocket] Emitted '${event}' to user ${normalizedId}`);
    } else {
      if (!this.pendingEvents.has(normalizedId)) {
        this.pendingEvents.set(normalizedId, []);
      }
      this.pendingEvents.get(normalizedId).push({ event, payload, queuedAt: Date.now() });
      console.log(`[WebSocket] Queued '${event}' for user ${normalizedId} (not connected)`);
    }
  }

  flushPendingEvents(userId, socket) {
    const normalizedId = Number(userId);
    const pending = this.pendingEvents.get(normalizedId);
    if (!pending || pending.length === 0) return;

    const cutoff = Date.now() - 5 * 60 * 1000;
    const fresh = pending.filter(e => e.queuedAt > cutoff);

    fresh.forEach(({ event, payload }) => {
      socket.emit(event, payload);
      console.log(`[WebSocket] Flushed queued '${event}' to user ${normalizedId}`);
    });

    this.pendingEvents.delete(normalizedId);
  }

  /**
   * Get connected user count
   */
  getConnectedUserCount() {
    return this.connectedUsers.size;
  }

  /**
   * Check if user is connected
   */
  isUserConnected(userId) {
    return this.connectedUsers.has(Number(userId));
  }

  /**
   * Get user's socket
   */
  getUserSocket(userId) {
    const connection = this.connectedUsers.get(Number(userId));
    if (!connection) return null;
    return this.io.sockets.sockets.get(connection.socketId);
  }

  /**
   * Resync active match for a user upon connection
   * Handles cases where memory-based grace period passed but match is still active in DB
   */
  async resyncActiveMatch(socket, userId) {
    try {
      const match = await lobbyService.getActiveMatchForUser(userId);
      if (match && match.matchId) {
        console.log(`[WebSocket] Resyncing active match ${match.matchId} for user ${userId}`);
        
        // Join room
        socket.join(`match:${match.matchId}`);
        if (!this.matchRooms.has(match.matchId)) {
          this.matchRooms.set(match.matchId, new Set());
        }
        this.matchRooms.get(match.matchId).add(socket.id);

        // Notify client with full state needed to resume
        socket.emit('match_state_restored', {
          matchId: match.matchId,
          ...match,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error(`[WebSocket] Error resyncing match for user ${userId}:`, err.message);
    }
  }
}

module.exports = new WebSocketManager();
