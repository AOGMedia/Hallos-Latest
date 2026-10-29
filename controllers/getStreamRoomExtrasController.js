const User = require('../models/User');
const { resolveTarget, TargetError } = require('../services/getStreamTargets');
const { liveGiftService, GiftError } = require('../services/liveGiftService');
const liveChatMedia = require('../services/liveChatMediaService');
const { getStreamService } = require('../services/getStreamService');
const { resolveRecipient } = require('../services/giftRecipients');
const { avatarUrlOf } = require('../utils/userAvatar');

/**
 * In-room extras for GetStream live classes and series sessions: gifts and
 * chat photos. Each handler is built for one kind ('class' or 'session') —
 * see routes/getStreamRoutes.js and routes/getStreamSeriesRoutes.js.
 *
 * Gift and photo announcements are sent into the call by the server (as the
 * Hallos system user), so they can't be faked from a browser.
 */

const GIFT_EVENT = 'hallos.gift';
const CHAT_EVENT = 'hallos.chat';
const MAX_CAPTION_LENGTH = 500;

const displayName = (user, fallbackId) =>
  (user && `${user.firstname || ''} ${user.lastname || ''}`.trim()) || `User ${fallbackId}`;

const fail = (res, error, fallback) => {
  if (error instanceof TargetError || error instanceof GiftError || (error && error.status && error.status < 500)) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details || {})
    });
  }
  console.error(`[GetStream Room Extras] ${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
};

/** Loads the target and the caller's role; sends 403 if they don't belong in the room. */
const loadForUser = async (kind, req, res) => {
  const target = await resolveTarget(kind, req.params.id);
  const role = await target.roleOf(req.user.id);
  if (!role) {
    res.status(403).json({ success: false, message: "You don't have access to this class" });
    return null;
  }
  return { target, role };
};

/**
 * Gift catalogue, the caller's wallet balances and — for the host — what
 * they've received in this class/session.
 * GET .../:id/gifts-getstream
 */
const giftOverview = (kind) => async (req, res) => {
  try {
    const loaded = await loadForUser(kind, req, res);
    if (!loaded) return;
    const { target, role } = loaded;

    const [balances, received] = await Promise.all([
      liveGiftService.balancesOf(req.user.id),
      role === 'host' ? liveGiftService.hostTotals(target.contentType, target.id, target.hostUserId) : null
    ]);

    return res.json({
      success: true,
      data: {
        gifts: liveGiftService.catalog(),
        currency: target.currency,
        balances,
        // Attendees gift the host; hosts and co-hosts gift participants.
        canGift: true,
        ...(received ? { received } : {})
      }
    });
  } catch (error) {
    return fail(res, error, 'Failed to load gifts');
  }
};

/**
 * Send a gift: attendees to the host, hosts/co-hosts to a participant.
 * POST .../:id/gift-getstream  { giftCode, idempotencyKey, recipientId? }
 */
const sendGift = (kind) => async (req, res) => {
  try {
    const loaded = await loadForUser(kind, req, res);
    if (!loaded) return;
    const { target, role } = loaded;

    if (!target.isLive) return res.status(400).json({ success: false, message: 'Gifts can be sent while the class is live' });

    const { giftCode, idempotencyKey, recipientId: requested } = req.body || {};
    const recipient = await resolveRecipient(target, role, req.user.id, requested);
    if (recipient.error) return res.status(400).json({ success: false, message: recipient.error });

    const { gift, replay } = await liveGiftService.sendGift({
      senderId: req.user.id,
      recipientId: recipient.recipientId,
      contentType: target.contentType,
      contentId: target.id,
      contentCurrency: target.currency,
      giftCode,
      idempotencyKey
    });

    const [sender, receiver] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'firstname', 'lastname'] }),
      User.findByPk(recipient.recipientId, { attributes: ['id', 'firstname', 'lastname'] })
    ]);
    const described = liveGiftService.describeGift(gift);

    // Announce to everyone in the room (first time only). Best-effort: the
    // gift is already paid and recorded.
    if (!replay && target.callId) {
      getStreamService
        .broadcastSystemEvent(target.callId, {
          kind: GIFT_EVENT,
          id: gift.id,
          code: described.code,
          from: { id: String(req.user.id), name: displayName(sender, req.user.id) },
          to: {
            id: String(recipient.recipientId),
            name: displayName(receiver, recipient.recipientId),
            isHost: recipient.recipientId === target.hostUserId
          }
        })
        .catch((e) => console.error('[GetStream Room Extras] Gift announcement failed:', e.message));
    }

    return res.json({
      success: true,
      data: { gift: described, replay, balances: await liveGiftService.balancesOf(req.user.id) }
    });
  } catch (error) {
    return fail(res, error, 'Failed to send gift');
  }
};

/**
 * Share a photo in the room chat. The server stores it and announces it.
 * POST .../:id/chat-photo-getstream  multipart: photo, caption?, clientId
 */
const shareChatPhoto = (kind) => async (req, res) => {
  try {
    if (!liveChatMedia.isAvailable()) {
      return res.status(503).json({ success: false, message: "Photo sharing isn't available right now" });
    }
    const loaded = await loadForUser(kind, req, res);
    if (!loaded) return;
    const { target } = loaded;

    if (!target.isLive || !target.callId) {
      return res.status(400).json({ success: false, message: 'Photos can be shared while the class is live' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Choose a photo to share' });
    }

    const url = await liveChatMedia.uploadChatPhoto({ kind, id: target.id }, req.file.buffer);
    const caption = String((req.body && req.body.caption) || '').trim().slice(0, MAX_CAPTION_LENGTH);
    const clientId = String((req.body && req.body.clientId) || '').slice(0, 64) || `photo-${Date.now()}`;
    const sender = await User.findByPk(req.user.id, { attributes: ['id', 'firstname', 'lastname', 'socialLinks'] });
    const senderAvatar = avatarUrlOf(sender);

    await getStreamService.broadcastSystemEvent(target.callId, {
      kind: CHAT_EVENT,
      id: clientId,
      text: caption,
      photo: { url },
      from: {
        id: String(req.user.id),
        name: displayName(sender, req.user.id),
        ...(senderAvatar && /^https:\/\//i.test(senderAvatar) ? { image: senderAvatar } : {})
      }
    });

    return res.json({ success: true, data: { id: clientId, url } });
  } catch (error) {
    return fail(res, error, 'Failed to share photo');
  }
};

module.exports = { giftOverview, sendGift, shareChatPhoto };
