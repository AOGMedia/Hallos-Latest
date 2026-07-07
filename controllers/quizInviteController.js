/**
 * Quiz Invite Controller
 *
 * Endpoints for sending quiz invitations via email, SMS, and WhatsApp.
 * - POST /api/quiz/invite/email      — send via email
 * - POST /api/quiz/invite/sms        — send via SMS (Twilio)
 * - GET  /api/quiz/invite/share-links — get WhatsApp + SMS share URLs (no server-side send)
 */

const quizInviteService = require('../services/quizInviteService');

/**
 * POST /api/quiz/invite/email
 * Send an email invite.
 *
 * Body:
 *   - toEmail (string, required): recipient email
 *   - inviterName (string, required): display name of the inviter
 */
exports.sendEmailInvite = async (req, res) => {
  try {
    const { toEmail, inviterName } = req.body;

    if (!toEmail || !toEmail.trim()) {
      return res.status(400).json({ error: 'toEmail is required' });
    }

    if (!inviterName || !inviterName.trim()) {
      return res.status(400).json({ error: 'inviterName is required' });
    }

    const inviterUserId = req.user?.id; // From auth middleware

    if (!inviterUserId) {
      return res.status(401).json({ error: 'Unauthorized: user not authenticated' });
    }

    const result = await quizInviteService.sendEmailInvite({
      toEmail: toEmail.trim(),
      inviterName: inviterName.trim(),
      inviterUserId
    });

    res.status(200).json({
      success: true,
      message: `Invite sent to ${toEmail}`,
      ...result
    });
  } catch (error) {
    console.error('[sendEmailInvite] error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to send email invite'
    });
  }
};

/**
 * POST /api/quiz/invite/sms
 * Send an SMS invite via Twilio.
 *
 * Body:
 *   - toPhone (string, required): recipient phone (e.g. +2347074119865 or 2347074119865)
 *   - inviterName (string, required): display name of the inviter
 */
exports.sendSmsInvite = async (req, res) => {
  try {
    const { toPhone, inviterName } = req.body;

    if (!toPhone || !toPhone.trim()) {
      return res.status(400).json({ error: 'toPhone is required' });
    }

    if (!inviterName || !inviterName.trim()) {
      return res.status(400).json({ error: 'inviterName is required' });
    }

    const inviterUserId = req.user?.id;

    if (!inviterUserId) {
      return res.status(401).json({ error: 'Unauthorized: user not authenticated' });
    }

    const result = await quizInviteService.sendSmsInvite({
      toPhone: toPhone.trim(),
      inviterName: inviterName.trim(),
      inviterUserId
    });

    res.status(200).json({
      success: true,
      message: `SMS invite sent to ${toPhone}`,
      ...result
    });
  } catch (error) {
    console.error('[sendSmsInvite] error:', error.message);
    res.status(error.message.includes('not configured') ? 503 : 500).json({
      error: error.message || 'Failed to send SMS invite'
    });
  }
};

/**
 * GET /api/quiz/invite/share-links
 * Generate WhatsApp and SMS share URLs for the frontend to open.
 * No server-side send; the frontend opens these URLs directly.
 *
 * Query:
 *   - inviterName (string, optional): if not provided, uses user.firstName or 'Friend'
 */
exports.getShareLinks = async (req, res) => {
  try {
    const inviterUserId = req.user?.id;

    if (!inviterUserId) {
      return res.status(401).json({ error: 'Unauthorized: user not authenticated' });
    }

    let inviterName = req.query.inviterName || req.user?.firstName || 'Friend';
    inviterName = inviterName.trim();

    const result = quizInviteService.getShareLinks({
      inviterName,
      inviterUserId
    });

    res.status(200).json({
      success: true,
      message: 'Share links generated',
      ...result
    });
  } catch (error) {
    console.error('[getShareLinks] error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to generate share links'
    });
  }
};
