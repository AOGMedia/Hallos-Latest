const { Op } = require('sequelize');
const User = require('../models/User');
const { safe, recent, namesById } = require('../utils/insightQueries');

/**
 * The long tail of the admin user page: full lists behind the headline numbers.
 * Private message text is deliberately left out; staff see how much someone
 * chats, not what they said.
 *
 * Models are required when called so this adds nothing to sequelize.sync().
 */
const models = () => ({
  ChatConversation: require('../models/ChatConversation'),
  ChutaCoinTransaction: require('../models/ChutaCoinTransaction'),
  CollaborationRequest: require('../models/CollaborationRequest'),
  Company: require('../models/Company'),
  CommunityAnnouncementComment: require('../models/CommunityAnnouncementComment'),
  CommunityContentSubmission: require('../models/CommunityContentSubmission'),
  Coupon: require('../models/Coupon'),
  CouponUsage: require('../models/CouponUsage'),
  EmailCampaign: require('../models/EmailCampaign'),
  EmailCampaignRecipient: require('../models/EmailCampaignRecipient'),
  Freebie: require('../models/Freebie'),
  FreebieAccess: require('../models/FreebieAccess'),
  FreebieDownload: require('../models/FreebieDownload'),
  LiveGift: require('../models/LiveGift'),
  LiveHost: require('../models/liveHost'),
  NotificationLog: require('../models/NotificationLog'),
  NotificationPreference: require('../models/NotificationPreference'),
  QuizInvite: require('../models/QuizInvite'),
  QuizMatch: require('../models/QuizMatch'),
  QuizTournament: require('../models/QuizTournament'),
  QuizTournamentParticipant: require('../models/QuizTournamentParticipant'),
  ReferralCommission: require('../models/ReferralCommission'),
  Transaction: require('../models/Transaction'),
  UserReferral: require('../models/UserReferral'),
  Wallet: require('../models/Wallet'),
});

const fullNames = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await User.findAll({
    where: { id: unique },
    attributes: ['id', 'firstname', 'lastname'],
    raw: true,
  });
  return new Map(rows.map((row) => [row.id, [row.firstname, row.lastname].filter(Boolean).join(' ')]));
};

async function loadMoneyDetails(id, m) {
  const [earnings, earningHistory, chutaHistory, gifts] = await Promise.all([
    safe('earnings', async () => (await m.Wallet.findAll({ where: { userId: id }, raw: true })).map((row) => ({
      currency: row.currency,
      total: Number(row.totalEarnings) || 0,
      withdrawn: Number(row.withdrawnAmount) || 0,
      pending: Number(row.pendingAmount) || 0,
    })), []),
    safe('earning history', async () => (await recent(m.Transaction, { userId: id })).map((row) => ({
      id: row.id,
      type: row.transactionType,
      amount: Number(row.amount) || 0,
      currency: row.currency,
      description: row.description,
      createdAt: row.createdAt,
    })), []),
    safe('chuta history', async () => (await recent(m.ChutaCoinTransaction, { userId: id })).map((row) => ({
      id: row.id,
      amount: Number(row.amount) || 0,
      balanceAfter: Number(row.balanceAfter) || 0,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt,
    })), []),
    safe('gift list', async () => (await recent(m.LiveGift, {
      [Op.or]: [{ senderId: id }, { recipientId: id }],
    })).map((row) => {
      const isSender = row.senderId === id;
      return {
        id: row.id,
        direction: isSender ? 'sent' : 'received',
        giftCode: row.giftCode,
        currency: row.currency,
        amount: Number(isSender ? row.amount : row.hostAmount) / 100,
        createdAt: row.createdAt,
      };
    }), []),
  ]);
  return { earnings, earningHistory, chutaHistory, gifts };
}

async function loadQuizDetails(id, m) {
  const [matches, entries, invitesSent] = await Promise.all([
    safe('match list', () => recent(m.QuizMatch, { [Op.or]: [{ challengerId: id }, { opponentId: id }] }), []),
    safe('tournament list', () => recent(m.QuizTournamentParticipant, { userId: id }, {
      order: [['registeredAt', 'DESC']],
    }), []),
    safe('quiz invites', () => m.QuizInvite.count({ where: { inviterUserId: id } }), 0),
  ]);

  const [opponents, tournaments] = await Promise.all([
    safe('opponents', () => fullNames(matches.map((row) => (row.challengerId === id ? row.opponentId : row.challengerId))), new Map()),
    safe('tournament names', () => namesById(m.QuizTournament, entries.map((row) => row.tournamentId), 'name'), new Map()),
  ]);

  return {
    quizInvitesSent: invitesSent,
    quizMatches: matches.map((row) => ({
      id: row.id,
      opponent: opponents.get(row.challengerId === id ? row.opponentId : row.challengerId) ?? null,
      status: row.status,
      result: row.status !== 'completed' ? null : row.winnerId === id ? 'won' : row.winnerId ? 'lost' : 'draw',
      wager: Number(row.escrowAmount) || 0,
      playedAt: row.completedAt ?? row.startedAt ?? row.createdAt,
    })),
    quizTournaments: entries.map((row) => ({
      id: row.id,
      name: tournaments.get(row.tournamentId) ?? null,
      status: row.status,
      placement: row.placement,
      prizeWon: Number(row.prizeWon) || 0,
      score: Number(row.totalScore) || 0,
      registeredAt: row.registeredAt,
    })),
  };
}

async function loadReferralDetails(id, m) {
  const [referred, commissions] = await Promise.all([
    safe('referred people', () => recent(m.UserReferral, { partnerUserId: id }, { order: [['signedUpAt', 'DESC']] }), []),
    safe('commission list', () => recent(m.ReferralCommission, { referrerUserId: id }, { order: [['purchasedAt', 'DESC']] }), []),
  ]);
  const names = await safe('referred names', () => fullNames([
    ...referred.map((row) => row.creatorUserId),
    ...commissions.map((row) => row.refereeUserId),
  ]), new Map());

  return {
    referredPeople: referred.map((row) => ({
      id: row.id,
      userId: row.creatorUserId,
      name: names.get(row.creatorUserId) ?? null,
      code: row.referralCode,
      active: row.commissionActive,
      signedUpAt: row.signedUpAt,
    })),
    commissions: commissions.map((row) => ({
      id: row.id,
      from: names.get(row.refereeUserId) ?? null,
      amount: Number(row.commissionAmount) || 0,
      currency: row.currency,
      contentType: row.contentType,
      purchasedAt: row.purchasedAt,
    })),
  };
}

async function loadEngagementDetails(id, m) {
  const inConversation = { [Op.or]: [{ userLowId: id }, { userHighId: id }] };
  const [usages, created, downloads, paidFreebies, requests, notifications, preferences, recipients,
    conversations, comments, submissions, coHosted] = await Promise.all([
    safe('coupon usage', () => recent(m.CouponUsage, { userId: id }), []),
    safe('coupons created', () => recent(m.Coupon, { [Op.or]: [{ creatorId: id }, { partnerUserId: id }] }), []),
    safe('freebie downloads', () => recent(m.FreebieDownload, { userId: id }), []),
    safe('freebie purchases', () => recent(m.FreebieAccess, { userId: id }), []),
    safe('agency requests', () => recent(m.CollaborationRequest, { userId: id }, { order: [['sentAt', 'DESC']] }), []),
    safe('notifications', () => recent(m.NotificationLog, { userId: id }, { order: [['sentAt', 'DESC']] }), []),
    safe('preferences', () => m.NotificationPreference.findOne({ where: { userId: id }, raw: true }), null),
    safe('campaign recipients', () => recent(m.EmailCampaignRecipient, { userId: id }), []),
    safe('conversations', () => m.ChatConversation.count({ where: inConversation }), 0),
    safe('comments', () => m.CommunityAnnouncementComment.count({ where: { userId: id } }), 0),
    safe('submissions', () => m.CommunityContentSubmission.count({ where: { submittedBy: id } }), 0),
    safe('co-hosted', () => m.LiveHost.count({ where: { userId: id } }), 0),
  ]);

  const [couponCodes, freebieNames, companies, campaigns] = await Promise.all([
    safe('coupon codes', () => namesById(m.Coupon, usages.map((row) => row.couponId), 'code'), new Map()),
    safe('freebie names', () => namesById(m.Freebie, [
      ...downloads.map((row) => row.freebieId),
      ...paidFreebies.map((row) => row.freebieId),
    ]), new Map()),
    safe('companies', () => namesById(m.Company, requests.map((row) => row.companyId), 'companyName'), new Map()),
    safe('campaign subjects', () => namesById(m.EmailCampaign, recipients.map((row) => row.campaignId), 'subject'), new Map()),
  ]);

  return {
    conversations,
    communityComments: comments,
    communitySubmissions: submissions,
    liveClassesCoHosted: coHosted,
    couponsUsed: usages.map((row) => ({
      id: row.id,
      code: couponCodes.get(row.couponId) ?? null,
      discount: Number(row.discountAmount) || 0,
      finalPrice: Number(row.finalPrice) || 0,
      currency: row.currency,
      contentType: row.contentType,
      usedAt: row.createdAt,
    })),
    couponsCreated: created.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      uses: row.usageCount,
      limit: row.usageLimit,
      expiresAt: row.expiresAt,
    })),
    freebies: [
      ...paidFreebies.map((row) => ({
        id: `paid-${row.id}`,
        title: freebieNames.get(row.freebieId) ?? null,
        paid: Number(row.amountPaid) || 0,
        currency: row.currency,
        at: row.createdAt,
      })),
      ...downloads.map((row) => ({
        id: `download-${row.id}`,
        title: freebieNames.get(row.freebieId) ?? null,
        paid: 0,
        currency: null,
        at: row.createdAt,
      })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)),
    agencyRequests: requests.map((row) => ({
      id: row.id,
      company: companies.get(row.companyId) ?? null,
      status: row.status,
      sentAt: row.sentAt,
    })),
    notifications: notifications.map((row) => ({
      id: row.id,
      contentType: row.contentType,
      type: row.notificationType,
      sentAt: row.sentAt,
    })),
    notificationPreferences: preferences && {
      instantLiveClassEmails: preferences.instantLiveClassEmails,
      dailyDigestEmails: preferences.dailyDigestEmails,
      weeklyDigestEmails: preferences.weeklyDigestEmails,
      allowCreatorRelatedOnly: preferences.allowCreatorRelatedOnly,
      disableAllEmails: preferences.disableAllEmails,
    },
    campaigns: recipients.map((row) => ({
      id: row.id,
      subject: campaigns.get(row.campaignId) ?? null,
      status: row.status,
      sentAt: row.sentAt ?? row.createdAt,
    })),
  };
}

async function loadDetails(id) {
  const m = models();
  const money = await loadMoneyDetails(id, m);
  const quiz = await loadQuizDetails(id, m);
  const referrals = await loadReferralDetails(id, m);
  const engagement = await loadEngagementDetails(id, m);
  return { details: { ...money, ...quiz, ...referrals, ...engagement } };
}

module.exports = { loadDetails };
