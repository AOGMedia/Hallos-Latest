const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { ChatConversation, ChatMessage } = require('../models/chatIndex');
const QuizMatch = require('../models/QuizMatch');
const QuizInvite = require('../models/QuizInvite');
const QuizInviteClaim = require('../models/QuizInviteClaim');
const UserQuizStats = require('../models/UserQuizStats');
const User = require('../models/User');

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Quiz Chat Service
 *
 * 1:1 messaging between players who have actually encountered each other
 * in the app — an opponent from a match (any status), or someone linked
 * via an invite in either direction. Not an open DM surface: areContacts()
 * is the single gate everything else in this file trusts.
 */
class ChatService {
  /**
   * Normalize a userId pair to (low, high) so a conversation lookup/create
   * is order-independent — chat has no challenger/opponent asymmetry.
   */
  _pairKey(userAId, userBId) {
    const a = Number(userAId);
    const b = Number(userBId);
    return a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a };
  }

  /**
   * Resolve a display identity the same way the rest of the quiz product
   * does — quiz nickname/avatar first, falling back to a stable synthetic
   * name for a user who has never registered a quiz profile. Mirrors
   * quizInviteService.resolveInviterName.
   */
  async _resolveDisplay(userId) {
    const [stats, user] = await Promise.all([
      UserQuizStats.findOne({ where: { userId }, attributes: ['nickname', 'avatarUrl'] }),
      User.findByPk(userId, { attributes: ['firstname'] })
    ]);
    return {
      userId: Number(userId),
      nickname: stats?.nickname || user?.firstname || `Player_${userId}`,
      avatarUrl: stats?.avatarUrl || null
    };
  }

  /**
   * Any QuizMatch between the two users, any status — covers the legacy
   * challenger/opponent columns (1v1 lobby matches) and the participants
   * JSONB array (needed for tournament-mode matches, where those columns
   * can be null). Mirrors the JSONB-containment query style already used
   * in lobbyService.js.
   */
  async _matchExistsBetween(a, b) {
    const match = await QuizMatch.findOne({
      where: {
        [Op.and]: [
          {
            [Op.or]: [
              { challengerId: a },
              { opponentId: a },
              sequelize.literal(`participants @> '[{"userId": ${a}}]'`)
            ]
          },
          {
            [Op.or]: [
              { challengerId: b },
              { opponentId: b },
              sequelize.literal(`participants @> '[{"userId": ${b}}]'`)
            ]
          }
        ]
      },
      attributes: ['id']
    });
    return !!match;
  }

  /**
   * A QuizInvite/QuizInviteClaim link in either direction: a invited b (and
   * b claimed it), or b invited a. Written as two flat id-list queries
   * rather than a nested-include where-clause — this codebase has no
   * precedent anywhere for Sequelize's $association.column$ syntax, and
   * this function gates whether two people can talk to each other at all,
   * not a good place to lean on an unverified query shape.
   */
  async _inviteLinkExists(a, b) {
    const [invitesByA, invitesByB] = await Promise.all([
      QuizInvite.findAll({ where: { inviterUserId: a }, attributes: ['id'] }),
      QuizInvite.findAll({ where: { inviterUserId: b }, attributes: ['id'] })
    ]);

    const aInviteIds = invitesByA.map((i) => i.id);
    const bInviteIds = invitesByB.map((i) => i.id);

    if (aInviteIds.length > 0) {
      const claimedByB = await QuizInviteClaim.findOne({
        where: { inviteId: { [Op.in]: aInviteIds }, inviteeUserId: b },
        attributes: ['id']
      });
      if (claimedByB) return true;
    }
    if (bInviteIds.length > 0) {
      const claimedByA = await QuizInviteClaim.findOne({
        where: { inviteId: { [Op.in]: bInviteIds }, inviteeUserId: a },
        attributes: ['id']
      });
      if (claimedByA) return true;
    }
    return false;
  }

  /**
   * True if userAId and userBId have prior contact: any QuizMatch between
   * them (any status), or a QuizInvite/QuizInviteClaim link either way.
   * Fails closed to false. Run once to gate conversation creation — not
   * re-checked on every message once a conversation exists.
   */
  async areContacts(userAId, userBId) {
    const a = Number(userAId);
    const b = Number(userBId);
    if (!a || !b || a === b) return false;

    if (await this._matchExistsBetween(a, b)) return true;
    return this._inviteLinkExists(a, b);
  }

  /**
   * Get the existing conversation between two users, or create one after
   * verifying prior contact. Idempotent under the unique (user_low_id,
   * user_high_id) index — a race between two near-simultaneous calls
   * resolves to the same row via findOrCreate.
   */
  async getOrCreateConversation(userAId, userBId) {
    const a = Number(userAId);
    const b = Number(userBId);
    if (!a || !b || a === b) {
      throw new Error('Invalid participants');
    }

    const isContact = await this.areContacts(a, b);
    if (!isContact) {
      const err = new Error('You can only message players you have played or exchanged an invite with');
      err.code = 'NOT_A_CONTACT';
      throw err;
    }

    const pair = this._pairKey(a, b);
    const [conversation, isNew] = await ChatConversation.findOrCreate({
      where: pair,
      defaults: pair
    });

    return { conversation, isNew };
  }

  /** Throws if userId is not one of the two participants in conversationId. */
  async _assertParticipant(conversationId, userId) {
    const conversation = await ChatConversation.findByPk(conversationId);
    if (!conversation) {
      const err = new Error('Conversation not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const id = Number(userId);
    if (conversation.userLowId !== id && conversation.userHighId !== id) {
      const err = new Error('You are not a participant in this conversation');
      err.code = 'FORBIDDEN';
      throw err;
    }
    return conversation;
  }

  /**
   * Persist a message and update the conversation's denormalized preview
   * fields. `sanitizedBody` must already have passed through
   * quizInputSanitizer.sanitizeString() — this function does not sanitize,
   * it only enforces length and participancy.
   */
  async sendMessage(conversationId, senderId, sanitizedBody) {
    const body = (sanitizedBody || '').trim();
    if (!body) throw new Error('Message body cannot be empty');
    if (body.length > MAX_MESSAGE_LENGTH) throw new Error(`Message body exceeds ${MAX_MESSAGE_LENGTH} character limit`);

    const conversation = await this._assertParticipant(conversationId, senderId);
    const sender = Number(senderId);
    const recipientId = conversation.userLowId === sender ? conversation.userHighId : conversation.userLowId;

    const message = await ChatMessage.create({
      conversationId: conversation.id,
      senderId: sender,
      recipientId,
      body
    });

    await conversation.update({
      lastMessageAt: message.createdAt,
      lastMessagePreview: body.slice(0, 200),
      lastMessageSenderId: sender
    });

    return message;
  }

  /** Paginated conversation list for a user, newest activity first, enriched with the other participant's display identity and unread count. */
  async listConversations(userId, { page = 1, limit = 20 } = {}) {
    const id = Number(userId);
    const offset = (page - 1) * limit;

    const { count, rows } = await ChatConversation.findAndCountAll({
      where: { [Op.or]: [{ userLowId: id }, { userHighId: id }] },
      order: [['lastMessageAt', 'DESC']],
      limit,
      offset
    });

    const conversations = await Promise.all(rows.map(async (conversation) => {
      const otherUserId = conversation.userLowId === id ? conversation.userHighId : conversation.userLowId;
      const [otherUser, unreadCount] = await Promise.all([
        this._resolveDisplay(otherUserId),
        ChatMessage.count({
          where: { conversationId: conversation.id, recipientId: id, readAt: null }
        })
      ]);

      return {
        id: conversation.id,
        otherUser,
        lastMessagePreview: conversation.lastMessagePreview,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount
      };
    }));

    return { conversations, total: count, page, totalPages: Math.ceil(count / limit) || 1 };
  }

  /** Paginated message history, newest-first (matches standard chat-load UX — frontend reverses for display order). */
  async listMessages(conversationId, requesterId, { page = 1, limit = 30 } = {}) {
    await this._assertParticipant(conversationId, requesterId);
    const offset = (page - 1) * limit;

    const { count, rows } = await ChatMessage.findAndCountAll({
      where: { conversationId },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    return {
      messages: rows.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt,
        readAt: m.readAt
      })),
      total: count,
      page,
      totalPages: Math.ceil(count / limit) || 1
    };
  }

  /** Marks every unread message addressed to requesterId in this conversation as read. */
  async markConversationRead(conversationId, requesterId) {
    await this._assertParticipant(conversationId, requesterId);
    const [markedCount] = await ChatMessage.update(
      { readAt: new Date() },
      { where: { conversationId, recipientId: Number(requesterId), readAt: null } }
    );
    return markedCount;
  }

  /** Total unread count across every conversation for a user — powers the sidebar badge. */
  async getUnreadCount(userId) {
    return ChatMessage.count({ where: { recipientId: Number(userId), readAt: null } });
  }
}

module.exports = new ChatService();
