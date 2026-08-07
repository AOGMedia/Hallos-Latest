/**
 * Quiz Invite Service
 *
 * "Invite a friend to play" — works regardless of whether the friend
 * already has an account, is online right now, or has never heard of
 * hallos before.
 *
 * A QuizInvite is a persisted, tokenized, expiring link under the quiz
 * feature's route on the main site:
 *   {CLIENT_URL}/dashboard/games/invite/{token}   e.g. https://hallos.net/dashboard/games/invite/{token}
 *
 * It can be claimed by any authenticated user (after signup, login, or
 * OAuth — the frontend just calls claimInvite() once it has a session,
 * regardless of how that session was obtained). Claiming:
 *   - Auto-matches the invitee with the inviter into a live game if the
 *     inviter is online, the invitee has a quiz profile, and the invite
 *     specified a category (best case: click link -> straight into play).
 *   - Otherwise records the claim and notifies the inviter (email now,
 *     plus a live socket ping if/when they're next online) so they can
 *     challenge their friend as soon as both are ready.
 *
 * A single invite link can be claimed by many different people (e.g.
 * shared in a group chat) — mirrors the ReferralCode -> UserReferral
 * split already used for partner referrals elsewhere in this codebase.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const QuizInvite = require('../models/QuizInvite');
const QuizInviteClaim = require('../models/QuizInviteClaim');
const QuizCategory = require('../models/QuizCategory');
const UserQuizStats = require('../models/UserQuizStats');
const User = require('../models/User');
const activeUserTracker = require('./activeUserTracker');
const quizWalletService = require('./quizWalletService');
const suspiciousActivityService = require('./suspiciousActivityService');
const { sendQuizInviteEmail, sendQuizFriendJoinedEmail } = require('../utils/email');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ACTIVE_INVITES_PER_USER = 25;
const DEFAULT_EXPIRY_DAYS = 30;
const STANDING_EXPIRY_DAYS = 365;
const ALLOWED_CHANNELS = ['email', 'sms', 'whatsapp', 'link'];

class QuizInviteService {
  // ---------------------------------------------------------------------
  // Link building
  // ---------------------------------------------------------------------

  /**
   * The quiz feature lives at /dashboard/games on the main site, not on a
   * separate subdomain.
   */
  _quizAppBase() {
    const base = (process.env.CLIENT_URL || 'https://hallos.net').replace(/\/$/, '');
    return `${base}/dashboard/games`;
  }

  /**
   * Resolve a display name for the inviter from their own profile — never trust
   * client-supplied "inviterName" input, since this name gets emailed/texted to a
   * real third party and a spoofed value would be an easy impersonation vector.
   */
  async resolveInviterName(userId) {
    const [stats, user] = await Promise.all([
      UserQuizStats.findOne({ where: { userId }, attributes: ['nickname'] }),
      User.findByPk(userId, { attributes: ['firstname'] })
    ]);
    return stats?.nickname || user?.firstname || `Player_${userId}`;
  }

  buildInviteUrl(token) {
    return `${this._quizAppBase()}/invite/${token}`;
  }

  buildWhatsAppShareUrl(inviterName, inviteUrl) {
    const message =
      `🎮 *${inviterName}* is challenging you to a quiz on Hallos!\n\n` +
      `Test your knowledge, win Chuta coins, and have fun.\n\n` +
      `Join now 👉 ${inviteUrl}`;
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  buildSmsContent(inviterName, inviteUrl) {
    const smsBody =
      `${inviterName} is challenging you to a quiz on Hallos! ` +
      `Win Chuta coins and have fun. Join now: ${inviteUrl}`;
    const smsUri = `sms:?body=${encodeURIComponent(smsBody)}`;
    return { smsUri, smsBody };
  }

  async _generateUniqueToken() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const token = crypto.randomBytes(24).toString('base64url');
      const existing = await QuizInvite.findOne({ where: { token }, attributes: ['id'] });
      if (!existing) return token;
    }
    throw new Error('Failed to generate a unique invite token after 10 attempts');
  }

  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  /**
   * Create a new shareable, trackable invite link.
   *
   * @param {Object} params
   * @param {number} params.inviterUserId
   * @param {string} params.inviterName
   * @param {string} [params.channel='link'] - 'email' | 'sms' | 'whatsapp' | 'link'
   * @param {string} [params.toEmail]
   * @param {string} [params.toPhone]
   * @param {number} [params.wagerAmount=0]
   * @param {string} [params.categoryId] - optional; required for auto-match on claim
   * @param {number} [params.expiresInDays=30] - 1-90
   * @param {string} [params.creatorIp]
   * @returns {Promise<{invite: Object, inviteUrl: string, whatsappUrl: string, smsUri: string}>}
   */
  async createInvite(params) {
    const {
      inviterUserId,
      inviterName,
      channel = 'link',
      toEmail = null,
      toPhone = null,
      wagerAmount = 0,
      categoryId = null,
      expiresInDays = DEFAULT_EXPIRY_DAYS,
      creatorIp = null
    } = params;

    if (!ALLOWED_CHANNELS.includes(channel)) {
      throw new Error(`channel must be one of: ${ALLOWED_CHANNELS.join(', ')}`);
    }
    if (channel === 'email' && (!toEmail || !toEmail.includes('@'))) {
      throw new Error('A valid toEmail is required for the email channel');
    }
    if (channel === 'sms' && !toPhone) {
      throw new Error('toPhone is required for the sms channel');
    }

    const amount = parseFloat(wagerAmount) || 0;
    if (amount < 0) {
      throw new Error('wagerAmount must be non-negative');
    }

    if (categoryId) {
      if (!UUID_REGEX.test(categoryId)) {
        throw new Error('categoryId must be a valid UUID');
      }
      const category = await QuizCategory.findByPk(categoryId, { attributes: ['id'] });
      if (!category) {
        throw new Error('categoryId does not exist');
      }
    }

    // Soft balance sanity-check — the authoritative check happens again at claim time,
    // since balance can change between now and whenever the friend actually joins.
    if (amount > 0) {
      const balanceCheck = await quizWalletService.verifyBalance(inviterUserId, amount);
      if (!balanceCheck.sufficient) {
        throw new Error(`Insufficient balance to offer a ${amount} Chuta wager. You have ${balanceCheck.currentBalance} Chuta.`);
      }
    }

    // Abuse guard: cap outstanding invites per user (the reusable standing link doesn't count).
    const activeCount = await QuizInvite.count({
      where: {
        inviterUserId,
        status: 'active',
        isStanding: false,
        expiresAt: { [Op.gt]: new Date() }
      }
    });
    if (activeCount >= MAX_ACTIVE_INVITES_PER_USER) {
      throw new Error(`You have too many active invites (${MAX_ACTIVE_INVITES_PER_USER}). Revoke some before creating more.`);
    }

    const clampedDays = Math.min(90, Math.max(1, parseInt(expiresInDays, 10) || DEFAULT_EXPIRY_DAYS));
    const token = await this._generateUniqueToken();

    const invite = await QuizInvite.create({
      token,
      inviterUserId,
      channel,
      toEmail,
      toPhone,
      wagerAmount: amount,
      categoryId,
      status: 'active',
      creatorIp,
      expiresAt: new Date(Date.now() + clampedDays * 24 * 60 * 60 * 1000)
    });

    const inviteUrl = this.buildInviteUrl(token);
    const whatsappUrl = this.buildWhatsAppShareUrl(inviterName, inviteUrl);
    const { smsUri } = this.buildSmsContent(inviterName, inviteUrl);

    if (channel === 'email') {
      await sendQuizInviteEmail(toEmail, inviterName, inviteUrl);
    } else if (channel === 'sms') {
      await this._sendSmsViaTwilio(toPhone, inviterName, inviteUrl);
    }

    return { invite, inviteUrl, whatsappUrl, smsUri };
  }

  async _sendSmsViaTwilio(toPhone, inviterName, inviteUrl) {
    const phone = toPhone.startsWith('+') ? toPhone : `+${toPhone}`;
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      throw new Error(
        'SMS is not configured on this server. ' +
        'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in environment.'
      );
    }

    const twilio = require('twilio');
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const { smsBody } = this.buildSmsContent(inviterName, inviteUrl);

    return client.messages.create({ body: smsBody, from: TWILIO_PHONE_NUMBER, to: phone });
  }

  /**
   * Get (or lazily create) the one reusable, long-lived "generic share link" per user.
   * Used by the passive "no players online, invite a friend!" CTAs so repeated polling
   * doesn't spawn a new DB row every time.
   */
  async getOrCreateStandingInvite(inviterUserId) {
    const existing = await QuizInvite.findOne({
      where: { inviterUserId, isStanding: true, status: 'active', expiresAt: { [Op.gt]: new Date() } }
    });
    if (existing) return existing;

    const token = await this._generateUniqueToken();
    try {
      return await QuizInvite.create({
        token,
        inviterUserId,
        channel: 'link',
        wagerAmount: 0,
        categoryId: null,
        status: 'active',
        isStanding: true,
        expiresAt: new Date(Date.now() + STANDING_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      });
    } catch (err) {
      // Concurrent request already created it (partial unique index) — fetch it.
      if (err.name === 'SequelizeUniqueConstraintError') {
        const raceWinner = await QuizInvite.findOne({ where: { inviterUserId, isStanding: true } });
        if (raceWinner) return raceWinner;
      }
      throw err;
    }
  }

  /**
   * Generate WhatsApp and SMS share links using the reusable standing invite
   * (no server-side send — the frontend opens these URLs directly).
   */
  async getShareLinks({ inviterName, inviterUserId }) {
    const invite = await this.getOrCreateStandingInvite(inviterUserId);
    const inviteUrl = this.buildInviteUrl(invite.token);
    const whatsappUrl = this.buildWhatsAppShareUrl(inviterName, inviteUrl);
    const { smsUri } = this.buildSmsContent(inviterName, inviteUrl);
    return { whatsappUrl, smsUri, inviteUrl };
  }

  // ---------------------------------------------------------------------
  // Resolve (public — landing page before the friend has even logged in)
  // ---------------------------------------------------------------------

  async resolveInvite(token) {
    const invite = await QuizInvite.findOne({ where: { token } });
    if (!invite) {
      return { found: false };
    }

    const now = new Date();
    const isExpired = now > new Date(invite.expiresAt);
    if (isExpired && invite.status === 'active') {
      await invite.update({ status: 'expired' });
    }

    // Fire-and-forget click tracking
    invite.increment('clicksCount').catch(() => {});

    const [inviterStats, inviterUser, category, inviterOnline] = await Promise.all([
      UserQuizStats.findOne({ where: { userId: invite.inviterUserId }, attributes: ['nickname', 'avatarUrl'] }),
      User.findByPk(invite.inviterUserId, { attributes: ['firstname', 'lastname'] }),
      invite.categoryId ? QuizCategory.findByPk(invite.categoryId, { attributes: ['name'] }) : null,
      activeUserTracker.isUserActive(invite.inviterUserId)
    ]);

    let recipientHasAccount = null;
    if (invite.toEmail) {
      const existingUser = await User.findOne({
        where: { email: { [Op.iLike]: invite.toEmail } },
        attributes: ['id']
      });
      recipientHasAccount = !!existingUser;
    }

    return {
      found: true,
      valid: invite.status === 'active' && !isExpired,
      expired: isExpired || invite.status === 'expired',
      revoked: invite.status === 'revoked',
      channel: invite.channel,
      wagerAmount: parseFloat(invite.wagerAmount),
      categoryId: invite.categoryId,
      categoryName: category?.name || null,
      recipientHasAccount,
      inviter: {
        userId: invite.inviterUserId,
        nickname: inviterStats?.nickname || inviterUser?.firstname || `Player_${invite.inviterUserId}`,
        avatarUrl: inviterStats?.avatarUrl || null,
        online: inviterOnline
      }
    };
  }

  // ---------------------------------------------------------------------
  // Claim (authed — called right after the invitee has a session, no
  // matter how they got it: signup, login, or OAuth)
  // ---------------------------------------------------------------------

  /**
   * @param {Object} params
   * @param {string} params.token
   * @param {number} params.inviteeUserId
   * @param {string} [params.ip]
   * @returns {Promise<Object>} claim result — see inline outcome comments
   */
  async claimInvite({ token, inviteeUserId, ip = null }) {
    const invite = await QuizInvite.findOne({ where: { token } });
    if (!invite) {
      return { success: false, reason: 'not_found' };
    }

    // Idempotency: never double-process the same person claiming the same link twice
    // (app remounts, double-tapped CTA, etc.) — return what already happened.
    const existingClaim = await QuizInviteClaim.findOne({
      where: { inviteId: invite.id, inviteeUserId }
    });
    if (existingClaim) {
      return this._buildClaimResponse(invite, existingClaim, { alreadyClaimed: true });
    }

    // Self-invite guard — block silently, no error surfaced (avoids tipping off abuse attempts
    // and avoids breaking UX for an accidental self-click).
    if (invite.inviterUserId === inviteeUserId) {
      const claim = await QuizInviteClaim.create({
        inviteId: invite.id,
        inviteeUserId,
        outcome: 'self_blocked',
        claimIp: ip
      });
      return this._buildClaimResponse(invite, claim, {});
    }

    const now = new Date();
    const isExpired = now > new Date(invite.expiresAt);
    if (invite.status === 'revoked' || invite.status === 'expired' || isExpired) {
      if (isExpired && invite.status === 'active') {
        await invite.update({ status: 'expired' });
      }
      const claim = await QuizInviteClaim.create({
        inviteId: invite.id,
        inviteeUserId,
        outcome: invite.status === 'revoked' ? 'revoked' : 'expired',
        claimIp: ip
      });
      return this._buildClaimResponse(invite, claim, {});
    }

    // The invitee is here right now via an authenticated HTTP call, which may land
    // before their socket connects — mark them active so the online-opponent check
    // inside createChallenge/acceptChallenge doesn't spuriously fail.
    await activeUserTracker.markUserActive(inviteeUserId);

    const suspiciousSameIp = !!(ip && invite.creatorIp && ip === invite.creatorIp);
    if (suspiciousSameIp) {
      // Non-blocking — two genuine friends on the same wifi/cyber cafe is common and
      // shouldn't be punished, but repeated same-IP invite claims across many accounts
      // should surface for review.
      suspiciousActivityService.flagSuspiciousPattern(inviteeUserId, {
        reason: 'quiz_invite_same_ip_as_inviter',
        inviterUserId: invite.inviterUserId,
        inviteId: invite.id
      }).catch(() => {});
    }

    const matchAttempt = await this._attemptAutoMatch(invite, inviteeUserId);

    const claim = await QuizInviteClaim.create({
      inviteId: invite.id,
      inviteeUserId,
      outcome: matchAttempt.matched ? 'matched' : 'pending_notify',
      matchId: matchAttempt.matchId || null,
      claimIp: ip,
      suspiciousSameIp
    });

    await invite.increment('claimsCount');

    // Notify the inviter — durable email always, plus a live nudge if they're online.
    // Never block the invitee's response on this.
    this._notifyInviter(invite, claim, inviteeUserId, matchAttempt).catch(err => {
      console.error('[QuizInviteService] _notifyInviter failed (non-critical):', err.message);
    });

    return this._buildClaimResponse(invite, claim, { matchPayload: matchAttempt.payload });
  }

  /**
   * Try to fully seat the invitee into a live match with the inviter.
   * Falls back cleanly (refunding any escrow) on any failure — claiming an
   * invite should never leave the invitee in a broken state.
   */
  async _attemptAutoMatch(invite, inviteeUserId) {
    if (!invite.categoryId) {
      return { matched: false, reason: 'no_category_on_invite' };
    }

    const inviterOnline = await activeUserTracker.isUserActive(invite.inviterUserId);
    if (!inviterOnline) {
      return { matched: false, reason: 'inviter_offline' };
    }

    const inviteeProfile = await UserQuizStats.findOne({ where: { userId: inviteeUserId }, attributes: ['userId'] });
    if (!inviteeProfile) {
      return { matched: false, reason: 'invitee_not_registered_for_quiz' };
    }

    const lobbyService = require('./lobbyService');
    let challengeResult;
    try {
      challengeResult = await lobbyService.createChallenge(
        invite.inviterUserId,
        parseFloat(invite.wagerAmount),
        invite.categoryId,
        inviteeUserId
      );
    } catch (err) {
      console.warn('[QuizInviteService] Auto-match createChallenge failed, falling back to pending_notify:', err.message);
      return { matched: false, reason: 'challenge_creation_failed', error: err.message };
    }

    try {
      const acceptResult = await lobbyService.acceptChallenge(challengeResult.challengeId, inviteeUserId);
      return { matched: true, matchId: challengeResult.challengeId, payload: acceptResult };
    } catch (err) {
      console.warn('[QuizInviteService] Auto-match acceptChallenge failed, cancelling and falling back:', err.message);
      try {
        await lobbyService.cancelChallenge(challengeResult.challengeId, invite.inviterUserId);
      } catch (cancelErr) {
        console.error('[QuizInviteService] Failed to clean up unaccepted auto-match challenge:', cancelErr.message);
      }
      return { matched: false, reason: 'invitee_could_not_accept', error: err.message };
    }
  }

  async _notifyInviter(invite, claim, inviteeUserId, matchAttempt) {
    const [inviterUser, inviteeStats, inviteeUser] = await Promise.all([
      User.findByPk(invite.inviterUserId, { attributes: ['email', 'firstname'] }),
      UserQuizStats.findOne({ where: { userId: inviteeUserId }, attributes: ['nickname'] }),
      User.findByPk(inviteeUserId, { attributes: ['firstname'] })
    ]);

    const friendName = inviteeStats?.nickname || inviteeUser?.firstname || 'Your friend';
    const ctaUrl = matchAttempt.matched
      ? `${this._quizAppBase()}/match/${matchAttempt.matchId}`
      : this._quizAppBase();

    let notified = false;

    if (inviterUser?.email) {
      try {
        await sendQuizFriendJoinedEmail(inviterUser.email, inviterUser.firstname, friendName, ctaUrl, matchAttempt.matched);
        notified = true;
      } catch (err) {
        console.error('[QuizInviteService] sendQuizFriendJoinedEmail failed:', err.message);
      }
    }

    try {
      const websocketManager = require('./websocketManager');
      const socket = websocketManager.getUserSocket(invite.inviterUserId);
      if (socket) {
        socket.emit('quiz_invite_claimed', {
          inviteId: invite.id,
          friendName,
          inviteeUserId,
          matched: matchAttempt.matched,
          matchId: matchAttempt.matchId || null
        });
        notified = true;
      }
    } catch (err) {
      console.error('[QuizInviteService] Live invite-claim socket notify failed:', err.message);
    }

    if (notified) {
      await claim.update({ inviterNotifiedAt: new Date() });
    }
  }

  /**
   * Called on socket connect (see websocketManager.handleConnection) so an inviter who
   * was offline when their friend joined still gets a live in-app nudge once they're back,
   * on top of the email they already received.
   */
  async notifyPendingInviteClaims(inviterUserId) {
    try {
      const claims = await QuizInviteClaim.findAll({
        where: { inviterNotifiedAt: null },
        include: [{
          model: QuizInvite,
          as: 'invite',
          where: { inviterUserId },
          attributes: ['id']
        }],
        limit: 10,
        order: [['createdAt', 'ASC']]
      });

      if (claims.length === 0) return;

      const websocketManager = require('./websocketManager');
      const socket = websocketManager.getUserSocket(inviterUserId);
      if (!socket) return;

      for (const claim of claims) {
        const [inviteeStats, inviteeUser] = await Promise.all([
          UserQuizStats.findOne({ where: { userId: claim.inviteeUserId }, attributes: ['nickname'] }),
          User.findByPk(claim.inviteeUserId, { attributes: ['firstname'] })
        ]);
        socket.emit('quiz_invite_claimed', {
          inviteId: claim.inviteId,
          friendName: inviteeStats?.nickname || inviteeUser?.firstname || 'Your friend',
          inviteeUserId: claim.inviteeUserId,
          matched: claim.outcome === 'matched',
          matchId: claim.matchId || null
        });
        await claim.update({ inviterNotifiedAt: new Date() });
      }
    } catch (err) {
      console.error('[QuizInviteService] notifyPendingInviteClaims failed (non-critical):', err.message);
    }
  }

  _buildClaimResponse(invite, claim, extra) {
    return {
      success: true,
      outcome: claim.outcome,
      matched: claim.outcome === 'matched',
      matchId: claim.matchId || null,
      inviterUserId: invite.inviterUserId,
      ...extra
    };
  }

  // ---------------------------------------------------------------------
  // Management
  // ---------------------------------------------------------------------

  async listMyInvites(inviterUserId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { count, rows } = await QuizInvite.findAndCountAll({
      where: { inviterUserId, isStanding: false },
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    return {
      invites: rows.map(invite => ({
        id: invite.id,
        inviteUrl: this.buildInviteUrl(invite.token),
        channel: invite.channel,
        toEmail: invite.toEmail,
        toPhone: invite.toPhone,
        wagerAmount: parseFloat(invite.wagerAmount),
        categoryId: invite.categoryId,
        status: invite.status,
        clicksCount: invite.clicksCount,
        claimsCount: invite.claimsCount,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt
      })),
      totalCount: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  async revokeInvite(inviteId, inviterUserId) {
    const invite = await QuizInvite.findByPk(inviteId);
    if (!invite) {
      throw new Error('Invite not found');
    }
    if (invite.inviterUserId !== inviterUserId) {
      throw new Error('You can only revoke your own invites');
    }
    if (invite.status !== 'active') {
      throw new Error('Only active invites can be revoked');
    }
    await invite.update({ status: 'revoked' });
    return { success: true };
  }

  // ---------------------------------------------------------------------
  // Legacy single-shot senders (kept for API compatibility)
  // ---------------------------------------------------------------------

  async sendEmailInvite({ toEmail, inviterName, inviterUserId }) {
    const { inviteUrl } = await this.createInvite({
      inviterUserId,
      inviterName,
      channel: 'email',
      toEmail
    });
    return { success: true, channel: 'email', inviteUrl };
  }

  async sendSmsInvite({ toPhone, inviterName, inviterUserId }) {
    const { inviteUrl } = await this.createInvite({
      inviterUserId,
      inviterName,
      channel: 'sms',
      toPhone
    });
    return { success: true, channel: 'sms', inviteUrl };
  }
}

module.exports = new QuizInviteService();
