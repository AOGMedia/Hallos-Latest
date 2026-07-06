const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../config/db');
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const Payout = require('../models/Payout');
const Video = require('../models/Video');
const LiveClass = require('../models/liveClass');
const Course = require('../models/Course');
const CourseEnrollment = require('../models/CourseEnrollment');

/**
 * Admin Dashboard Controller
 *
 * Provides platform-wide statistics and management endpoints:
 * - Platform overview (users, revenue, content)
 * - User management (list, view, change role, suspend)
 * - Payout management (list pending, approve, reject)
 * - Content statistics
 */

// ─── helpers ────────────────────────────────────────────────────────────────

function startOf(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── 1. Platform Overview Dashboard ─────────────────────────────────────────

/**
 * GET /api/admin/dashboard
 * High-level platform snapshot
 */
exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const today = startOf(0);
    const last7 = startOf(7);
    const last30 = startOf(30);

    // ── Users ──
    const [totalUsers, newUsersToday, newUsersLast7, newUsersLast30] = await Promise.all([
      User.count(),
      User.count({ where: { createdAt: { [Op.gte]: today } } }),
      User.count({ where: { createdAt: { [Op.gte]: last7 } } }),
      User.count({ where: { createdAt: { [Op.gte]: last30 } } }),
    ]);

    // ── Revenue (completed purchases) ──
    const revenueRows = await Purchase.findAll({
      where: { paymentStatus: 'completed' },
      attributes: [
        'currency',
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: ['currency'],
      raw: true,
    });

    const revenueAllTime = {};
    revenueRows.forEach(r => {
      revenueAllTime[r.currency] = { total: parseFloat(r.total), count: parseInt(r.count) };
    });

    const revenueLast30Rows = await Purchase.findAll({
      where: { paymentStatus: 'completed', createdAt: { [Op.gte]: last30 } },
      attributes: [
        'currency',
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: ['currency'],
      raw: true,
    });

    const revenueLast30 = {};
    revenueLast30Rows.forEach(r => {
      revenueLast30[r.currency] = { total: parseFloat(r.total), count: parseInt(r.count) };
    });

    // ── Revenue by content type (all time) ──
    const revenueByTypeRows = await Purchase.findAll({
      where: { paymentStatus: 'completed' },
      attributes: [
        'contentType',
        'currency',
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: ['contentType', 'currency'],
      raw: true,
    });

    const revenueByType = {};
    revenueByTypeRows.forEach(r => {
      if (!revenueByType[r.contentType]) revenueByType[r.contentType] = {};
      revenueByType[r.contentType][r.currency] = { total: parseFloat(r.total), count: parseInt(r.count) };
    });

    // ── Payouts ──
    const [pendingPayouts, pendingPayoutAmount] = await Promise.all([
      Payout.count({ where: { status: 'pending' } }),
      Payout.findOne({
        where: { status: 'pending' },
        attributes: [[fn('SUM', col('amount')), 'total']],
        raw: true,
      }),
    ]);

    // ── Content counts ──
    const [totalVideos, totalLiveClasses, totalCourses, activeLiveClasses] = await Promise.all([
      Video.count(),
      LiveClass.count(),
      Course.count({ where: { isActive: true } }),
      LiveClass.count({ where: { status: 'live' } }),
    ]);

    // ── Course enrollments ──
    const [totalEnrollments, pendingCredentials] = await Promise.all([
      CourseEnrollment.count(),
      CourseEnrollment.count({ where: { credentialsSent: false } }),
    ]);

    return res.status(200).json({
      success: true,
      users: {
        total: totalUsers,
        newToday: newUsersToday,
        newLast7Days: newUsersLast7,
        newLast30Days: newUsersLast30,
      },
      revenue: {
        allTime: revenueAllTime,
        last30Days: revenueLast30,
        byContentType: revenueByType,
      },
      payouts: {
        pendingCount: pendingPayouts,
        pendingAmount: parseFloat(pendingPayoutAmount?.total || 0),
      },
      content: {
        videos: totalVideos,
        liveClasses: totalLiveClasses,
        activeLiveClasses,
        courses: totalCourses,
        courseEnrollments: totalEnrollments,
        pendingCredentials,
      },
    });
  } catch (error) {
    console.error('[Admin Dashboard] getDashboard error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};

// ─── 2. User Management ──────────────────────────────────────────────────────

/**
 * GET /api/admin/users
 * Paginated user list with search and role filter
 */
exports.getUsers = async (req, res) => {
  try {
    const { search, role, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (role) where.role = role;
    if (search) {
      where[Op.or] = [
        { firstname: { [Op.iLike]: `%${search}%` } },
        { lastname: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: ['id', 'firstname', 'lastname', 'email', 'role', 'country', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: Math.min(parseInt(limit), 100),
      offset,
    });

    return res.status(200).json({
      success: true,
      users: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('[Admin Dashboard] getUsers error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
};

/**
 * GET /api/admin/users/:id
 * Full profile for a single user — includes wallet balances, purchase history, payout history
 */
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: ['id', 'firstname', 'lastname', 'email', 'role', 'country', 'bio', 'phoneNumber', 'createdAt'],
    });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Purchases
    const purchases = await Purchase.findAll({
      where: { userId: id, paymentStatus: 'completed' },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });

    // Payouts
    const payouts = await Payout.findAll({
      where: { userId: id },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });

    // Wallet balances (wallet_accounts table)
    let walletBalances = {};
    try {
      const WalletAccount = sequelize.models.WalletAccount;
      if (WalletAccount) {
        const accounts = await WalletAccount.findAll({ where: { user_id: id } });
        accounts.forEach(a => {
          walletBalances[a.currency] = {
            available: (parseInt(a.balance_available) / 100).toFixed(2),
            pending: (parseInt(a.balance_pending) / 100).toFixed(2),
          };
        });
      }
    } catch (e) {
      console.warn('[Admin Dashboard] Could not fetch wallet accounts:', e.message);
    }

    // Course enrollments
    const enrollments = await CourseEnrollment.findAll({
      where: { userId: id },
      order: [['createdAt', 'DESC']],
      limit: 10,
    });

    // Purchase totals
    const purchaseTotals = {};
    purchases.forEach(p => {
      if (!purchaseTotals[p.currency]) purchaseTotals[p.currency] = 0;
      purchaseTotals[p.currency] += parseFloat(p.amount);
    });

    return res.status(200).json({
      success: true,
      user,
      walletBalances,
      purchaseSummary: {
        totalPurchases: purchases.length,
        totalSpent: purchaseTotals,
        recentPurchases: purchases.slice(0, 5),
      },
      payoutSummary: {
        totalPayouts: payouts.length,
        recentPayouts: payouts.slice(0, 5),
      },
      courseEnrollments: enrollments,
    });
  } catch (error) {
    console.error('[Admin Dashboard] getUserById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};

/**
 * PATCH /api/admin/users/:id/role
 * Change a user's role (viewer → creator → admin, etc.)
 */
exports.updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const VALID_ROLES = ['viewer', 'creator', 'admin'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Prevent admin from demoting themselves
    if (parseInt(id) === req.user.id && role !== 'admin') {
      return res.status(400).json({ success: false, message: 'You cannot change your own role' });
    }

    const previousRole = user.role;
    await user.update({ role });

    console.log(`[Admin Dashboard] User ${id} role changed: ${previousRole} → ${role} by admin ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: `User role updated to ${role}`,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('[Admin Dashboard] updateUserRole error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update role' });
  }
};

// ─── 3. Payout Management ────────────────────────────────────────────────────

/**
 * GET /api/admin/payouts
 * List payouts with status filter and pagination
 */
exports.getPayouts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const { count, rows } = await Payout.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstname', 'lastname', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: Math.min(parseInt(limit), 100),
      offset,
    });

    return res.status(200).json({
      success: true,
      payouts: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('[Admin Dashboard] getPayouts error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch payouts' });
  }
};

/**
 * PATCH /api/admin/payouts/:id/approve
 * Mark a payout as processing and trigger the actual transfer
 */
exports.approvePayout = async (req, res) => {
  try {
    const { id } = req.params;

    const payout = await Payout.findByPk(id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }],
    });

    if (!payout) return res.status(404).json({ success: false, message: 'Payout not found' });
    if (payout.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Payout is already ${payout.status}` });
    }

    // Trigger the actual transfer
    let result;
    try {
      const payoutService = require('../services/payoutService');
      if (payout.paymentGateway === 'paystack') {
        result = await payoutService.processPaystackPayout(id);
      } else {
        result = await payoutService.processStripePayout(id);
      }
    } catch (transferError) {
      console.error('[Admin Dashboard] Transfer failed:', transferError.message);
      return res.status(502).json({
        success: false,
        message: `Transfer failed: ${transferError.message}`,
        payoutId: id,
      });
    }

    console.log(`[Admin Dashboard] Payout ${id} approved by admin ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: 'Payout approved and transfer initiated',
      payout: result.payout,
    });
  } catch (error) {
    console.error('[Admin Dashboard] approvePayout error:', error);
    return res.status(500).json({ success: false, message: 'Failed to approve payout' });
  }
};

/**
 * PATCH /api/admin/payouts/:id/reject
 * Reject a payout and release the locked wallet funds back to available
 */
exports.rejectPayout = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) return res.status(400).json({ success: false, message: 'reason is required' });

    const payout = await Payout.findByPk(id);
    if (!payout) return res.status(404).json({ success: false, message: 'Payout not found' });
    if (payout.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Payout is already ${payout.status}` });
    }

    // Release locked funds back to available balance
    try {
      const { releaseLockedAmount } = require('../services/walletService');
      await releaseLockedAmount(payout.userId, parseFloat(payout.amount), payout.currency);
    } catch (walletError) {
      console.error('[Admin Dashboard] Failed to release locked funds:', walletError.message);
      // Continue — still mark as rejected even if wallet release fails
    }

    await payout.update({ status: 'failed', failureReason: reason });

    console.log(`[Admin Dashboard] Payout ${id} rejected by admin ${req.user.id}: ${reason}`);

    return res.status(200).json({
      success: true,
      message: 'Payout rejected and funds released back to user wallet',
      payout,
    });
  } catch (error) {
    console.error('[Admin Dashboard] rejectPayout error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reject payout' });
  }
};

// ─── 4. Content Statistics ───────────────────────────────────────────────────

/**
 * GET /api/admin/content-stats
 * Counts and revenue breakdown per content type
 */
exports.getContentStats = async (req, res) => {
  try {
    const { LiveSeries } = require('../models/liveSeriesIndex');

    const [
      totalVideos,
      readyVideos,
      totalLiveClasses,
      liveLiveClasses,
      totalLiveSeries,
      activeLiveSeries,
      totalCourses,
      activeCourses,
    ] = await Promise.all([
      Video.count(),
      Video.count({ where: { status: 'ready' } }),
      LiveClass.count(),
      LiveClass.count({ where: { status: 'live' } }),
      LiveSeries.count(),
      LiveSeries.count({ where: { status: 'active' } }),
      Course.count(),
      Course.count({ where: { isActive: true } }),
    ]);

    // Revenue per content type
    const revenueRows = await Purchase.findAll({
      where: { paymentStatus: 'completed' },
      attributes: [
        'contentType',
        'currency',
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('id')), 'sales'],
      ],
      group: ['contentType', 'currency'],
      raw: true,
    });

    const revenue = {};
    revenueRows.forEach(r => {
      if (!revenue[r.contentType]) revenue[r.contentType] = {};
      revenue[r.contentType][r.currency] = {
        total: parseFloat(r.total),
        sales: parseInt(r.sales),
      };
    });

    return res.status(200).json({
      success: true,
      content: {
        videos: { total: totalVideos, ready: readyVideos },
        liveClasses: { total: totalLiveClasses, live: liveLiveClasses },
        liveSeries: { total: totalLiveSeries, active: activeLiveSeries },
        courses: { total: totalCourses, active: activeCourses },
      },
      revenue,
    });
  } catch (error) {
    console.error('[Admin Dashboard] getContentStats error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch content stats' });
  }
};

/**
 * GET /api/admin/revenue
 * Daily revenue breakdown for a date range (default last 30 days)
 * Query params: startDate, endDate, currency
 */
exports.getRevenue = async (req, res) => {
  try {
    const { currency = 'NGN', days = 30 } = req.query;
    const since = startOf(parseInt(days));

    const rows = await Purchase.findAll({
      where: {
        paymentStatus: 'completed',
        currency: currency.toUpperCase(),
        createdAt: { [Op.gte]: since },
      },
      attributes: [
        [fn('DATE', col('created_at')), 'date'],
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: [fn('DATE', col('created_at'))],
      order: [[fn('DATE', col('created_at')), 'ASC']],
      raw: true,
    });

    return res.status(200).json({
      success: true,
      currency: currency.toUpperCase(),
      days: parseInt(days),
      data: rows.map(r => ({
        date: r.date,
        total: parseFloat(r.total),
        transactions: parseInt(r.count),
      })),
    });
  } catch (error) {
    console.error('[Admin Dashboard] getRevenue error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch revenue data' });
  }
};
