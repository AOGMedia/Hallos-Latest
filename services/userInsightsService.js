const { col, fn, Op } = require('sequelize');
const User = require('../models/User');
const { avatarUrlOf } = require('../utils/userAvatar');
const { LIST_LIMIT, safe, select, recent, namesById, totalsByCurrency } = require('../utils/insightQueries');
const { loadDetails } = require('./userInsightsDetails');

const EVENTS_PER_SOURCE = 50;
const MAX_EVENTS = 200;

/**
 * Everything the admin user page shows. Each section is loaded independently
 * and falls back to empty, so one missing table or bad row costs that section
 * only, never the whole page.
 *
 * Models are required when called, not at module load, so this file adds
 * nothing to what sequelize.sync() creates on boot.
 */
const models = () => ({
  Community: require('../models/Community'),
  CommunityMember: require('../models/CommunityMember'),
  CollaborationRequest: require('../models/CollaborationRequest'),
  ChatMessage: require('../models/ChatMessage'),
  Course: require('../models/Course'),
  CourseEnrollment: require('../models/CourseEnrollment'),
  CouponUsage: require('../models/CouponUsage'),
  EmailCampaignRecipient: require('../models/EmailCampaignRecipient'),
  EmailSuppression: require('../models/EmailSuppression'),
  Feedback: require('../models/Feedback'),
  Freebie: require('../models/Freebie'),
  FreebieDownload: require('../models/FreebieDownload'),
  LiveAttendee: require('../models/liveAttendee'),
  LiveClass: require('../models/liveClass'),
  LiveGift: require('../models/LiveGift'),
  LiveSeries: require('../models/LiveSeries'),
  LiveSeriesRegistration: require('../models/LiveSeriesRegistration'),
  NotificationLog: require('../models/NotificationLog'),
  Payout: require('../models/Payout'),
  Purchase: require('../models/Purchase'),
  QuizMatch: require('../models/QuizMatch'),
  QuizTournamentParticipant: require('../models/QuizTournamentParticipant'),
  ReferralCode: require('../models/ReferralCode'),
  ReferralCommission: require('../models/ReferralCommission'),
  UserQuizStats: require('../models/UserQuizStats'),
  UserReferral: require('../models/UserReferral'),
  Video: require('../models/Video'),
  VideoView: require('../models/VideoView'),
  WalletAccount: require('../models/WalletAccount'),
  WalletTransaction: require('../models/WalletTransaction'),
});

const CONTENT_MODELS = {
  video: ['Video', 'title'],
  live_class: ['LiveClass', 'title'],
  live_series: ['LiveSeries', 'title'],
  course: ['Course', 'name'],
  freebie: ['Freebie', 'title'],
};

/** Adds a readable `title` to rows that point at content by type and id. */
async function withContentTitles(rows, m) {
  const output = rows.map((row) => ({ ...row, title: null }));
  await Promise.all(
    Object.entries(CONTENT_MODELS).map(async ([type, [modelName, attribute]]) => {
      const matching = output.filter((row) => row.contentType === type);
      const names = await safe(`${type} titles`, () =>
        namesById(m[modelName], matching.map((row) => row.contentId), attribute), new Map());
      matching.forEach((row) => { row.title = names.get(row.contentId) ?? null; });
    })
  );
  return output;
}

const maskAccount = (number) => (number ? `••••${String(number).slice(-4)}` : null);

const fromMinorUnits = (value) => Number(value || 0) / 100;

async function loadProfile(user, m) {
  const { profilePicture, ...links } = user.socialLinks || {};
  const [login, suppression] = await Promise.all([
    safe('login stats', async () => (await select(
      'SELECT * FROM user_login_stats WHERE user_id = :id', { id: user.id }))[0] || null, null),
    safe('suppression', () => m.EmailSuppression.findOne({
      where: { email: String(user.email).trim().toLowerCase() }, raw: true,
    }), null),
  ]);

  return {
    profile: {
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      role: user.role,
      country: user.country,
      phoneNumber: user.phoneNumber,
      bio: user.bio,
      avatarUrl: avatarUrlOf(user),
      socialLinks: links,
      newsletterSubscribed: user.newsletterSubscribed,
      isUnsubscribed: Boolean(suppression),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    login: login && {
      lastLoginAt: login.last_login_at,
      loginCount: login.login_count,
      lastMethod: login.last_method,
      lastIp: login.last_ip,
      lastUserAgent: login.last_user_agent,
    },
  };
}

async function loadMoney(id, m) {
  const accounts = await safe('wallets', () => m.WalletAccount.findAll({ where: { user_id: id }, raw: true }), []);
  const accountIds = accounts.map((account) => account.id);
  const completed = { userId: id, paymentStatus: 'completed' };

  const [spent, spentByType, purchases, payouts, payoutCount, giftsSent, giftsReceived, walletTransactions, adjustments] =
    await Promise.all([
      safe('spend', () => totalsByCurrency(m.Purchase, completed, 'amount'), []),
      safe('spend by type', async () => {
        const rows = await m.Purchase.findAll({
          where: completed,
          attributes: ['contentType', 'currency', [fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
          group: ['contentType', 'currency'],
          raw: true,
        });
        return rows.map((row) => ({
          contentType: row.contentType,
          currency: row.currency,
          total: Number(row.total) || 0,
          count: Number(row.count) || 0,
        }));
      }, []),
      safe('purchases', async () => withContentTitles(await recent(m.Purchase, { userId: id }), m), []),
      safe('payouts', async () => (await recent(m.Payout, { userId: id })).map(({ accountNumber, ...payout }) => ({
        ...payout,
        accountNumber: maskAccount(accountNumber),
      })), []),
      safe('payout count', () => m.Payout.count({ where: { userId: id } }), 0),
      safe('gifts sent', () => totalsByCurrency(m.LiveGift, { senderId: id }, 'amount', 100), []),
      safe('gifts received', () => totalsByCurrency(m.LiveGift, { recipientId: id }, 'host_amount', 100), []),
      safe('wallet history', async () => {
        if (accountIds.length === 0) return [];
        const rows = await m.WalletTransaction.findAll({
          where: { wallet_account_id: accountIds },
          order: [['created_at', 'DESC']],
          limit: LIST_LIMIT,
          raw: true,
        });
        return rows.map((row) => ({
          id: row.id,
          type: row.transaction_type,
          amount: fromMinorUnits(row.amount),
          currency: row.currency,
          description: row.description,
          status: row.status,
          createdAt: row.created_at,
        }));
      }, []),
      safe('adjustments', () => select(
        `SELECT a.id, a.currency, a.direction, a.amount, a.reason, a.status, a.balance_after AS "balanceAfter",
                a.created_at AS "createdAt", a.admin_id AS "adminId"
           FROM admin_wallet_adjustments a
          WHERE a.user_id = :id ORDER BY a.created_at DESC LIMIT ${LIST_LIMIT}`, { id }), []),
    ]);

  const admins = await safe('adjusting admins', () =>
    namesById(User, adjustments.map((row) => row.adminId), 'firstname'), new Map());

  return {
    wallets: accounts.map((account) => ({
      currency: account.currency,
      available: fromMinorUnits(account.balance_available),
      pending: fromMinorUnits(account.balance_pending),
    })),
    money: {
      spent,
      spentByType,
      purchases,
      payouts,
      payoutCount,
      giftsSent,
      giftsReceived,
      walletTransactions,
      adjustments: adjustments.map((row) => ({
        ...row,
        amount: Number(row.amount),
        balanceAfter: row.balanceAfter === null ? null : Number(row.balanceAfter),
        adminName: admins.get(row.adminId) ?? null,
      })),
    },
  };
}

async function loadLearning(id, m) {
  const [joined, attended, seriesCount, seriesRows, courseCount, courseRows, videoStats, viewRows, freebies] =
    await Promise.all([
      safe('live count', () => m.LiveAttendee.count({ where: { userId: id } }), 0),
      safe('live classes', () => recent(m.LiveAttendee, { userId: id }), []),
      safe('series count', () => m.LiveSeriesRegistration.count({ where: { userId: id } }), 0),
      safe('series', () => recent(m.LiveSeriesRegistration, { userId: id }), []),
      safe('course count', () => m.CourseEnrollment.count({ where: { userId: id } }), 0),
      safe('courses', () => recent(m.CourseEnrollment, { userId: id }), []),
      safe('watch stats', async () => (await m.VideoView.findAll({
        where: { userId: id },
        attributes: [[fn('COUNT', col('id')), 'count'], [fn('SUM', col('watch_duration')), 'seconds']],
        raw: true,
      }))[0], {}),
      safe('videos watched', () => recent(m.VideoView, { userId: id }, { order: [['lastWatchedAt', 'DESC']] }), []),
      safe('freebies', () => m.FreebieDownload.count({ where: { userId: id } }), 0),
    ]);

  const [classNames, seriesNames, courseNames, videoNames] = await Promise.all([
    safe('class names', () => namesById(m.LiveClass, attended.map((row) => row.liveClassId)), new Map()),
    safe('series names', () => namesById(m.LiveSeries, seriesRows.map((row) => row.seriesId)), new Map()),
    safe('course names', () => namesById(m.Course, courseRows.map((row) => row.courseId), 'name'), new Map()),
    safe('video names', () => namesById(m.Video, viewRows.map((row) => row.videoId)), new Map()),
  ]);

  return {
    learning: {
      liveClassesJoined: joined,
      liveClasses: attended.map((row) => ({
        id: row.id,
        title: classNames.get(row.liveClassId) ?? null,
        paid: Boolean(row.statusPaid),
        joinedAt: row.createdAt,
      })),
      seriesEnrolled: seriesCount,
      series: seriesRows.map((row) => ({
        id: row.id, title: seriesNames.get(row.seriesId) ?? null, joinedAt: row.createdAt,
      })),
      coursesEnrolled: courseCount,
      courses: courseRows.map((row) => ({
        id: row.id,
        title: courseNames.get(row.courseId) ?? null,
        accessType: row.accessType,
        expiresAt: row.expiresAt,
        credentialsSent: row.credentialsSent,
        joinedAt: row.createdAt,
      })),
      videosWatched: Number(videoStats.count) || 0,
      watchSeconds: Number(videoStats.seconds) || 0,
      videos: viewRows.map((row) => ({
        id: row.id,
        title: videoNames.get(row.videoId) ?? null,
        watchSeconds: row.watchDuration,
        watchedAt: row.lastWatchedAt,
      })),
      freebiesDownloaded: freebies,
    },
  };
}

async function loadCreator(id, m) {
  const pick = (attributes) => ({ attributes });
  const [videoCount, totalViews, videos, liveCount, liveClasses, seriesCount, series, freebies] = await Promise.all([
    safe('video count', () => m.Video.count({ where: { userId: id } }), 0),
    safe('total views', () => m.Video.sum('viewsCount', { where: { userId: id } }), 0),
    safe('videos', () => recent(m.Video, { userId: id }, pick(['id', 'title', 'status', 'price', 'currency', 'viewsCount', 'createdAt'])), []),
    safe('hosted count', () => m.LiveClass.count({ where: { userId: id } }), 0),
    safe('hosted', () => recent(m.LiveClass, { userId: id }, pick(['id', 'title', 'status', 'price', 'currency', 'startTime', 'createdAt'])), []),
    safe('series count', () => m.LiveSeries.count({ where: { userId: id } }), 0),
    safe('series', () => recent(m.LiveSeries, { userId: id }, pick(['id', 'title', 'status', 'price', 'currency', 'startDate', 'createdAt'])), []),
    safe('freebies', () => m.Freebie.count({ where: { userId: id } }), 0),
  ]);

  return {
    creator: {
      videoCount,
      totalViews: Number(totalViews) || 0,
      videos,
      liveClassesHosted: liveCount,
      liveClasses,
      seriesCount,
      series,
      freebiesCreated: freebies,
    },
  };
}

async function loadSocial(id, m) {
  const quizWalletService = require('./quizWalletService');
  const inMatch = { [Op.or]: [{ challengerId: id }, { opponentId: id }] };

  const [memberships, stats, matches, wins, tournaments, prizeWon, chuta, referredBy, codes, earned, feedback,
    feedbackCount, messagesSent, messagesReceived, couponsUsed, agencyRequests, notifications, campaignEmails] =
    await Promise.all([
      safe('communities', () => recent(m.CommunityMember, { userId: id }), []),
      safe('quiz stats', () => m.UserQuizStats.findOne({ where: { userId: id }, raw: true }), null),
      safe('matches', () => m.QuizMatch.count({ where: inMatch }), 0),
      safe('wins', () => m.QuizMatch.count({ where: { winnerId: id } }), 0),
      safe('tournaments', () => m.QuizTournamentParticipant.count({ where: { userId: id } }), 0),
      safe('prizes', () => m.QuizTournamentParticipant.sum('prizeWon', { where: { userId: id } }), 0),
      safe('chuta', () => quizWalletService.getBalance(id), 0),
      safe('referred by', () => m.UserReferral.findOne({ where: { creatorUserId: id }, raw: true }), null),
      safe('codes', () => recent(m.ReferralCode, { partnerUserId: id }), []),
      safe('commissions', () => totalsByCurrency(m.ReferralCommission, { referrerUserId: id }, 'commission_amount'), []),
      safe('feedback', () => recent(m.Feedback, { userId: id }), []),
      safe('feedback count', () => m.Feedback.count({ where: { userId: id } }), 0),
      safe('messages sent', () => m.ChatMessage.count({ where: { senderId: id } }), 0),
      safe('messages received', () => m.ChatMessage.count({ where: { recipientId: id } }), 0),
      safe('coupons', () => m.CouponUsage.count({ where: { userId: id } }), 0),
      safe('agency', () => m.CollaborationRequest.count({ where: { userId: id } }), 0),
      safe('notifications', () => m.NotificationLog.count({ where: { userId: id } }), 0),
      safe('campaign emails', () => m.EmailCampaignRecipient.count({ where: { userId: id, status: 'sent' } }), 0),
    ]);

  const communityNames = await safe('community names', () =>
    namesById(m.Community, memberships.map((row) => row.communityId), 'name'), new Map());

  return {
    communities: memberships.map((row) => ({
      id: row.id,
      name: communityNames.get(row.communityId) ?? null,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt ?? row.createdAt,
    })),
    quiz: {
      nickname: stats?.nickname ?? null,
      avatarUrl: stats?.avatarUrl ?? null,
      overall: stats?.overallStats ?? null,
      lobby: stats?.lobbyStats ?? null,
      tournament: stats?.tournamentStats ?? null,
      lastMatchAt: stats?.lastMatchAt ?? null,
      matches,
      wins,
      tournaments,
      prizeWon: Number(prizeWon) || 0,
      chutaBalance: Number(chuta) || 0,
    },
    referrals: {
      referredByCode: referredBy?.referralCode ?? null,
      codes: codes.map((code) => ({
        id: code.id,
        code: code.referralCode,
        label: code.label,
        status: code.status,
        clicks: code.clicksCount,
        signups: code.successfulReferrals,
      })),
      earned,
    },
    engagement: {
      feedback: feedback.map((row) => ({
        id: row.id,
        rating: row.rating,
        category: row.category,
        subject: row.subject,
        message: row.message,
        status: row.status,
        createdAt: row.createdAt,
      })),
      feedbackCount,
      messagesSent,
      messagesReceived,
      couponsUsed,
      agencyRequests,
      notificationsSent: notifications,
      campaignEmails,
    },
  };
}

async function loadEmails(id) {
  const rows = await safe('sent emails', () => select(
    `SELECT id, subject, body_html AS "bodyHtml", status, error, sender_id AS "senderId", created_at AS "createdAt"
       FROM admin_user_emails WHERE user_id = :id ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`, { id }), []);
  const senders = await safe('email senders', () =>
    namesById(User, rows.map((row) => row.senderId), 'firstname'), new Map());
  return {
    emails: rows.map((row) => ({ ...row, senderName: senders.get(row.senderId) ?? null })),
  };
}

async function findUser(id) {
  if (!Number.isInteger(Number(id))) return null;
  return User.findByPk(id, {
    attributes: ['id', 'firstname', 'lastname', 'email', 'role', 'country', 'bio', 'phoneNumber',
      'socialLinks', 'newsletterSubscribed', 'createdAt', 'updatedAt'],
  });
}

async function getOverview(id) {
  const user = await findUser(id);
  if (!user) return null;
  const m = models();

  // In stages rather than all at once, to stay well inside the connection pool.
  const profile = await loadProfile(user, m);
  const money = await loadMoney(user.id, m);
  const learning = await loadLearning(user.id, m);
  const creator = await loadCreator(user.id, m);
  const social = await loadSocial(user.id, m);
  const emails = await loadEmails(user.id);
  const details = await loadDetails(user.id);

  return { ...profile, ...money, ...learning, ...creator, ...social, ...emails, ...details };
}

const event = (type, title, detail, at) => ({ type, title, detail: detail ?? null, at });

/** A single newest-first feed of what this person has done on the platform. */
async function getActivity(id) {
  const user = await findUser(id);
  if (!user) return null;
  const m = models();
  const newest = (Model, where, options = {}) =>
    Model.findAll({ where, order: [['createdAt', 'DESC']], limit: EVENTS_PER_SOURCE, raw: true, ...options });

  const sources = await Promise.all([
    safe('purchases', async () => {
      const rows = await withContentTitles(await newest(m.Purchase, { userId: user.id, paymentStatus: 'completed' }), m);
      return rows.map((row) => event('purchase', `Bought ${row.title ?? String(row.contentType).replace('_', ' ')}`,
        `${row.currency} ${Number(row.amount).toLocaleString('en-US')}`, row.createdAt));
    }, []),
    safe('live', async () => {
      const rows = await newest(m.LiveAttendee, { userId: user.id });
      const names = await namesById(m.LiveClass, rows.map((row) => row.liveClassId));
      return rows.map((row) => event('live', `Joined ${names.get(row.liveClassId) ?? 'a live class'}`, null, row.createdAt));
    }, []),
    safe('series', async () => {
      const rows = await newest(m.LiveSeriesRegistration, { userId: user.id });
      const names = await namesById(m.LiveSeries, rows.map((row) => row.seriesId));
      return rows.map((row) => event('live', `Enrolled in ${names.get(row.seriesId) ?? 'a live series'}`, null, row.createdAt));
    }, []),
    safe('courses', async () => {
      const rows = await newest(m.CourseEnrollment, { userId: user.id });
      const names = await namesById(m.Course, rows.map((row) => row.courseId), 'name');
      return rows.map((row) => event('course', `Enrolled in ${names.get(row.courseId) ?? 'a course'}`, row.accessType, row.createdAt));
    }, []),
    safe('views', async () => {
      const rows = await newest(m.VideoView, { userId: user.id }, { order: [['lastWatchedAt', 'DESC']] });
      const names = await namesById(m.Video, rows.map((row) => row.videoId));
      return rows.map((row) => event('video', `Watched ${names.get(row.videoId) ?? 'a video'}`, null, row.lastWatchedAt));
    }, []),
    safe('uploads', async () => (await newest(m.Video, { userId: user.id })).map((row) =>
      event('creator', `Uploaded ${row.title}`, null, row.createdAt)), []),
    safe('hosted', async () => (await newest(m.LiveClass, { userId: user.id })).map((row) =>
      event('creator', `Created live class ${row.title}`, null, row.createdAt)), []),
    safe('communities', async () => {
      const rows = await newest(m.CommunityMember, { userId: user.id });
      const names = await namesById(m.Community, rows.map((row) => row.communityId), 'name');
      return rows.map((row) => event('community', `Joined ${names.get(row.communityId) ?? 'a community'}`, row.role, row.joinedAt ?? row.createdAt));
    }, []),
    safe('matches', async () => (await newest(m.QuizMatch, {
      [Op.or]: [{ challengerId: user.id }, { opponentId: user.id }], status: 'completed',
    })).map((row) => event('quiz', row.winnerId === user.id ? 'Won a quiz match' : 'Played a quiz match', null, row.completedAt ?? row.createdAt)), []),
    safe('tournaments', async () => (await newest(m.QuizTournamentParticipant, { userId: user.id }, {
      order: [['registeredAt', 'DESC']],
    })).map((row) => event('quiz', 'Entered a quiz tournament', null, row.registeredAt)), []),
    safe('payouts', async () => (await newest(m.Payout, { userId: user.id })).map((row) =>
      event('money', `Requested a ${row.currency} ${Number(row.amount).toLocaleString('en-US')} payout`, row.status, row.createdAt)), []),
    safe('gifts', async () => (await newest(m.LiveGift, { senderId: user.id })).map((row) =>
      event('money', 'Sent a live gift', row.giftCode, row.createdAt)), []),
    safe('feedback', async () => (await newest(m.Feedback, { userId: user.id })).map((row) =>
      event('feedback', row.subject ? `Left feedback: ${row.subject}` : 'Left feedback', null, row.createdAt)), []),
    safe('freebies', async () => (await newest(m.FreebieDownload, { userId: user.id })).map((row) =>
      event('content', 'Downloaded a freebie', null, row.createdAt)), []),
    safe('adjustments', async () => (await select(
      `SELECT direction, amount, currency, reason, created_at FROM admin_wallet_adjustments
        WHERE user_id = :id AND status = 'completed' ORDER BY created_at DESC LIMIT ${EVENTS_PER_SOURCE}`, { id: user.id }
    )).map((row) => event('admin', `Wallet ${row.direction === 'credit' ? 'credited' : 'debited'} ${row.currency} ${Number(row.amount).toLocaleString('en-US')} by staff`, row.reason, row.created_at)), []),
    safe('emails', async () => (await select(
      `SELECT subject, created_at FROM admin_user_emails
        WHERE user_id = :id AND status = 'sent' ORDER BY created_at DESC LIMIT ${EVENTS_PER_SOURCE}`, { id: user.id }
    )).map((row) => event('admin', `Staff emailed: ${row.subject}`, null, row.created_at)), []),
    safe('login', async () => (await select(
      'SELECT last_login_at, last_method FROM user_login_stats WHERE user_id = :id', { id: user.id }
    )).map((row) => event('login', 'Logged in', row.last_method, row.last_login_at)), []),
  ]);

  return sources
    .flat()
    .concat(event('account', 'Created their account', null, user.createdAt))
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, MAX_EVENTS);
}

module.exports = { getOverview, getActivity };
