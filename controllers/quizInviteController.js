/**
 * Quiz Invite Controller
 *
 * "Invite a friend to play" endpoints — covers all three recipient states:
 * already online, has an account but offline, and no account at all.
 *
 * - POST /api/quiz/invite/create        — create a trackable, tokenized invite link
 * - GET  /api/quiz/invite/resolve/:token — public: resolve a link before login (landing page)
 * - POST /api/quiz/invite/claim         — authed: call once the invitee has a session
 *                                          (after signup, login, or OAuth — any of them)
 * - GET  /api/quiz/invite/mine          — list invites the current user has sent + their status
 * - POST /api/quiz/invite/:id/revoke    — cancel an outstanding invite
 * - POST /api/quiz/invite/email         — legacy: single-shot email invite
 * - POST /api/quiz/invite/sms           — legacy: single-shot SMS invite
 * - GET  /api/quiz/invite/share-links   — legacy: WhatsApp + SMS deep-links (no server send)
 */

const quizInviteService = require('../services/quizInviteService');

function getRequestIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.ip || req.connection?.remoteAddress || null;
}

/**
 * POST /api/quiz/invite/create
 * Body: { channel, toEmail?, toPhone?, wagerAmount?, categoryId?, expiresInDays? }
 */
exports.createInvite = async (req, res) => {
  try {
    const inviterUserId = req.user?.id;
    if (!inviterUserId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { channel, toEmail, toPhone, wagerAmount, categoryId, expiresInDays } = req.body;
    const inviterName = await quizInviteService.resolveInviterName(inviterUserId);

    const result = await quizInviteService.createInvite({
      inviterUserId,
      inviterName,
      channel,
      toEmail: toEmail?.trim(),
      toPhone: toPhone?.trim(),
      wagerAmount,
      categoryId,
      expiresInDays,
      creatorIp: getRequestIp(req)
    });

    return res.status(201).json({
      success: true,
      invite: {
        id: result.invite.id,
        channel: result.invite.channel,
        wagerAmount: parseFloat(result.invite.wagerAmount),
        categoryId: result.invite.categoryId,
        expiresAt: result.invite.expiresAt
      },
      inviteUrl: result.inviteUrl,
      whatsappUrl: result.whatsappUrl,
      smsUri: result.smsUri
    });
  } catch (error) {
    console.error('[QuizInviteController] createInvite error:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Failed to create invite' });
  }
};

/**
 * GET /api/quiz/invite/resolve/:token
 * Public — no auth. Lets the frontend render a landing page before the
 * invitee has logged in ("X invited you to play — Sign up or Log in").
 */
exports.resolveInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const result = await quizInviteService.resolveInvite(token);

    if (!result.found) {
      return res.status(404).json({ success: false, message: 'Invite not found' });
    }

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[QuizInviteController] resolveInvite error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to resolve invite' });
  }
};

/**
 * POST /api/quiz/invite/claim
 * Body: { token }
 * Call this once the invitee has an authenticated session — regardless of
 * whether that session came from signup, login, or OAuth.
 */
exports.claimInvite = async (req, res) => {
  try {
    const inviteeUserId = req.user?.id;
    if (!inviteeUserId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { token } = req.body;
    if (!token || !token.trim()) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    const result = await quizInviteService.claimInvite({
      token: token.trim(),
      inviteeUserId,
      ip: getRequestIp(req)
    });

    if (!result.success) {
      return res.status(404).json({ success: false, message: 'Invite not found' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[QuizInviteController] claimInvite error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Failed to claim invite' });
  }
};

/**
 * GET /api/quiz/invite/mine
 * List invites the current user has sent, with click/claim counts.
 */
exports.listMyInvites = async (req, res) => {
  try {
    const inviterUserId = req.user?.id;
    if (!inviterUserId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { page = 1, limit = 20 } = req.query;
    const result = await quizInviteService.listMyInvites(inviterUserId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[QuizInviteController] listMyInvites error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to list invites' });
  }
};

/**
 * POST /api/quiz/invite/:id/revoke
 */
exports.revokeInvite = async (req, res) => {
  try {
    const inviterUserId = req.user?.id;
    if (!inviterUserId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params;
    const result = await quizInviteService.revokeInvite(id, inviterUserId);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[QuizInviteController] revokeInvite error:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Failed to revoke invite' });
  }
};

/**
 * POST /api/quiz/invite/email (legacy — single-shot email invite)
 * Body: { toEmail }
 */
exports.sendEmailInvite = async (req, res) => {
  try {
    const { toEmail } = req.body;

    if (!toEmail || !toEmail.trim()) {
      return res.status(400).json({ error: 'toEmail is required' });
    }

    const inviterUserId = req.user?.id;
    if (!inviterUserId) {
      return res.status(401).json({ error: 'Unauthorized: user not authenticated' });
    }

    const inviterName = await quizInviteService.resolveInviterName(inviterUserId);
    const result = await quizInviteService.sendEmailInvite({
      toEmail: toEmail.trim(),
      inviterName,
      inviterUserId
    });

    res.status(200).json({ success: true, message: `Invite sent to ${toEmail}`, ...result });
  } catch (error) {
    console.error('[sendEmailInvite] error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send email invite' });
  }
};

/**
 * POST /api/quiz/invite/sms (legacy — single-shot SMS invite)
 * Body: { toPhone }
 */
exports.sendSmsInvite = async (req, res) => {
  try {
    const { toPhone } = req.body;

    if (!toPhone || !toPhone.trim()) {
      return res.status(400).json({ error: 'toPhone is required' });
    }

    const inviterUserId = req.user?.id;
    if (!inviterUserId) {
      return res.status(401).json({ error: 'Unauthorized: user not authenticated' });
    }

    const inviterName = await quizInviteService.resolveInviterName(inviterUserId);
    const result = await quizInviteService.sendSmsInvite({
      toPhone: toPhone.trim(),
      inviterName,
      inviterUserId
    });

    res.status(200).json({ success: true, message: `SMS invite sent to ${toPhone}`, ...result });
  } catch (error) {
    console.error('[sendSmsInvite] error:', error.message);
    res.status(error.message.includes('not configured') ? 503 : 500).json({
      error: error.message || 'Failed to send SMS invite'
    });
  }
};

/**
 * GET /api/quiz/invite/share-links (legacy — WhatsApp + SMS deep-links, no server-side send)
 */
exports.getShareLinks = async (req, res) => {
  try {
    const inviterUserId = req.user?.id;
    if (!inviterUserId) {
      return res.status(401).json({ error: 'Unauthorized: user not authenticated' });
    }

    const inviterName = await quizInviteService.resolveInviterName(inviterUserId);
    const result = await quizInviteService.getShareLinks({ inviterName, inviterUserId });

    res.status(200).json({ success: true, message: 'Share links generated', ...result });
  } catch (error) {
    console.error('[getShareLinks] error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to generate share links' });
  }
};
