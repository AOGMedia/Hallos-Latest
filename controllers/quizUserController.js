const quizWalletService = require('../services/quizWalletService');
const UserQuizStats = require('../models/UserQuizStats');

const DICEBEAR_STYLES = ['avataaars', 'pixel-art', 'bottts', 'lorelei', 'micah', 'adventurer'];
const DICEBEAR_BASE = 'https://api.dicebear.com/9.x';

/**
 * Validate a DiceBear avatar URL
 * Must be from api.dicebear.com, one of the allowed styles, svg or png format
 */
function isValidDiceBearUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'api.dicebear.com') return false;
    // Accept /9.x/{style}/svg or /9.x/{style}/png with optional trailing slash
    const styleMatch = parsed.pathname.match(/^\/9\.x\/([^/]+)\/(svg|png)\/?$/);
    if (!styleMatch) return false;
    if (!DICEBEAR_STYLES.includes(styleMatch[1])) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Quiz User Controller
 * 
 * Handles user-facing quiz operations:
 * - User registration (initial bonus)
 * - Balance queries
 * - Statistics
 * - Transaction history
 */

/**
 * Register user for quiz platform (credit initial bonus)
 * POST /api/quiz/user/register
 */
exports.register = async (req, res) => {
  try {
    const userId = req.user.id;
    const { nickname, avatarUrl } = req.body;

    // Validate nickname 
    if (!nickname || typeof nickname !== 'string') {
      return res.status(400).json({ success: false, message: 'nickname is required' });
    }
    const trimmed = nickname.trim();
    if (trimmed.length < 3 || trimmed.length > 30) {
      return res.status(400).json({ success: false, message: 'Nickname must be between 3 and 30 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return res.status(400).json({ success: false, message: 'Nickname can only contain letters, numbers, and underscores' });
    }

    // Validate avatarUrl
    if (!avatarUrl || !isValidDiceBearUrl(avatarUrl)) {
      return res.status(400).json({
        success: false,
        message: `avatarUrl must be a valid DiceBear URL. Example: ${DICEBEAR_BASE}/avataaars/svg?seed=YourNickname`,
        allowedStyles: DICEBEAR_STYLES
      });
    }

    const result = await quizWalletService.creditInitialBonus(userId, trimmed, avatarUrl);

    return res.status(result.success ? 200 : 409).json(result);
  } catch (error) {
    console.error('[Quiz User Controller] Register error:', error);
    // Nickname taken comes back as a thrown error from the service
    if (error.message && error.message.includes('Nickname already taken')) {
      return res.status(409).json({ success: false, message: error.message });
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to register for quiz platform'
    });
  }
};

/**
 * Get user's Chuta balance
 * GET /api/quiz/user/balance
 */
exports.getBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    const balance = await quizWalletService.getBalance(userId);

    return res.status(200).json({
      success: true,
      balance,
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('[Quiz User Controller] Get balance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get balance'
    });
  }
};

/**
 * Get user's quiz statistics
 * GET /api/quiz/user/stats
 */
exports.getStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const stats = await UserQuizStats.findOne({
      where: { userId }
    });

    if (!stats) {
      return res.status(200).json({
        success: true,
        lobbyStats: {},
        tournamentStats: {},
        overallStats: {}
      });
    }

    return res.status(200).json({
      success: true,
      lobbyStats: stats.lobbyStats,
      tournamentStats: stats.tournamentStats,
      overallStats: stats.overallStats,
      lastMatchAt: stats.lastMatchAt,
      lastTournamentAt: stats.lastTournamentAt
    });
  } catch (error) {
    console.error('[Quiz User Controller] Get stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get statistics'
    });
  }
};

/**
 * Get user's transaction history
 * GET /api/quiz/user/transactions
 */
exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, startDate, endDate, page = 1, limit = 20 } = req.query;

    const result = await quizWalletService.getTransactionHistory(userId, {
      type,
      startDate,
      endDate,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Quiz User Controller] Get transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get transaction history'
    });
  }
};

/**
 * Get quiz profile for any user (nickname + avatar + stats)
 * GET /api/quiz/user/profile/:userId
 */
exports.getProfile = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);

    const stats = await UserQuizStats.findOne({
      where: { userId: targetUserId }
    });

    if (!stats) {
      return res.status(404).json({ success: false, message: 'User has not registered for the quiz platform' });
    }

    return res.status(200).json({
      success: true,
      profile: {
        userId: stats.userId,
        nickname: stats.nickname,
        avatarUrl: stats.avatarUrl,
        lobbyStats: stats.lobbyStats,
        tournamentStats: stats.tournamentStats,
        overallStats: stats.overallStats,
        lastMatchAt: stats.lastMatchAt,
        lastTournamentAt: stats.lastTournamentAt
      }
    });
  } catch (error) {
    console.error('[Quiz User Controller] Get profile error:', error);
    return res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
};

/**
 * Check if a nickname is available
 * GET /api/quiz/user/check-nickname?nickname=xxx
 */
exports.checkNickname = async (req, res) => {
  try {
    const { nickname } = req.query;

    if (!nickname || nickname.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Provide at least 3 characters' });
    }

    const existing = await UserQuizStats.findOne({ where: { nickname: nickname.trim() } });

    return res.status(200).json({
      success: true,
      available: !existing,
      nickname: nickname.trim()
    });
  } catch (error) {
    console.error('[Quiz User Controller] Check nickname error:', error);
    return res.status(500).json({ success: false, message: 'Failed to check nickname' });
  }
};

const NICKNAME_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

/**
 * Update quiz profile (avatar always, nickname with 2-week cooldown)
 * PATCH /api/quiz/user/profile
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { nickname, avatarUrl } = req.body;

    if (!nickname && !avatarUrl) {
      return res.status(400).json({ success: false, message: 'Provide at least one of: nickname, avatarUrl' });
    }

    const stats = await UserQuizStats.findOne({ where: { userId } });
    if (!stats) {
      return res.status(404).json({ success: false, message: 'You have not registered for the quiz platform yet' });
    }

    const updates = {};

    // --- Avatar update (always allowed) ---
    if (avatarUrl !== undefined) {
      if (!isValidDiceBearUrl(avatarUrl)) {
        return res.status(400).json({
          success: false,
          message: `avatarUrl must be a valid DiceBear URL. Example: ${DICEBEAR_BASE}/avataaars/svg?seed=YourNickname`,
          allowedStyles: DICEBEAR_STYLES
        });
      }
      updates.avatarUrl = avatarUrl;
    }

    // --- Nickname update (2-week cooldown) ---
    if (nickname !== undefined) {
      const trimmed = nickname.trim();

      if (trimmed.length < 3 || trimmed.length > 30) {
        return res.status(400).json({ success: false, message: 'Nickname must be between 3 and 30 characters' });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
        return res.status(400).json({ success: false, message: 'Nickname can only contain letters, numbers, and underscores' });
      }

      // Same nickname — no-op, skip cooldown check
      if (trimmed !== stats.nickname) {
        // Cooldown check
        if (stats.nicknameChangedAt) {
          const elapsed = Date.now() - new Date(stats.nicknameChangedAt).getTime();
          if (elapsed < NICKNAME_COOLDOWN_MS) {
            const msLeft = NICKNAME_COOLDOWN_MS - elapsed;
            const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
            return res.status(429).json({
              success: false,
              message: `You can only change your nickname once every 2 weeks. Try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
              nextChangeAllowedAt: new Date(new Date(stats.nicknameChangedAt).getTime() + NICKNAME_COOLDOWN_MS)
            });
          }
        }

        // Uniqueness check
        const taken = await UserQuizStats.findOne({ where: { nickname: trimmed } });
        if (taken) {
          return res.status(409).json({ success: false, message: 'Nickname already taken. Please choose a different one.' });
        }

        updates.nickname = trimmed;
        updates.nicknameChangedAt = new Date();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(200).json({ success: true, message: 'No changes made', profile: { nickname: stats.nickname, avatarUrl: stats.avatarUrl } });
    }

    await stats.update(updates);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        nickname: stats.nickname,
        avatarUrl: stats.avatarUrl,
        nicknameChangedAt: stats.nicknameChangedAt
      }
    });
  } catch (error) {
    console.error('[Quiz User Controller] Update profile error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

module.exports = exports;
