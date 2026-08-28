/**
 * Quiz Chat Controller
 *
 * 1:1 messaging between players scoped to prior contact — see
 * chatService.areContacts for the exact rule. Mounted under
 * /api/quiz/chat/*, so request bodies already pass through the router's
 * global quizInputSanitizer.sanitizeAll() before reaching here.
 *
 * - GET  /api/quiz/chat/contacts/:userId/check           — gate the "Message" button client-side
 * - GET  /api/quiz/chat/conversations                    — list my conversations, paginated
 * - GET  /api/quiz/chat/conversations/with/:userId        — get-or-create a conversation with a contact
 * - GET  /api/quiz/chat/conversations/:conversationId/messages   — paginated message history
 * - POST /api/quiz/chat/conversations/:conversationId/messages   — REST fallback send
 * - POST /api/quiz/chat/conversations/:conversationId/read        — mark my unread messages as read
 * - GET  /api/quiz/chat/unread-count                      — total unread count, for the sidebar badge
 */

const chatService = require('../services/chatService');

function errorStatus(err) {
  if (err.code === 'NOT_A_CONTACT') return 403;
  if (err.code === 'FORBIDDEN') return 403;
  if (err.code === 'NOT_FOUND') return 404;
  return 400;
}

/**
 * GET /api/quiz/chat/contacts/:userId/check
 */
exports.checkContact = async (req, res) => {
  try {
    const myUserId = req.user.id;
    const { userId } = req.params;

    const isContact = await chatService.areContacts(myUserId, userId);
    return res.status(200).json({ success: true, isContact });
  } catch (error) {
    console.error('[Chat Controller] Check contact error:', error);
    return res.status(500).json({ success: false, message: 'Failed to check contact status' });
  }
};

/**
 * GET /api/quiz/chat/conversations
 * Query: page, limit
 */
exports.listConversations = async (req, res) => {
  try {
    const myUserId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const result = await chatService.listConversations(myUserId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[Chat Controller] List conversations error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load conversations' });
  }
};

/**
 * GET /api/quiz/chat/conversations/with/:userId
 * Get-or-create — 403 if the two users have no prior contact.
 */
exports.getOrCreateConversation = async (req, res) => {
  try {
    const myUserId = req.user.id;
    const { userId } = req.params;

    const { conversation, isNew } = await chatService.getOrCreateConversation(myUserId, userId);

    return res.status(200).json({ success: true, conversationId: conversation.id, isNew });
  } catch (error) {
    console.error('[Chat Controller] Get or create conversation error:', error);
    return res.status(errorStatus(error)).json({
      success: false,
      message: error.message || 'Failed to open conversation'
    });
  }
};

/**
 * GET /api/quiz/chat/conversations/:conversationId/messages
 * Query: page, limit
 */
exports.listMessages = async (req, res) => {
  try {
    const myUserId = req.user.id;
    const { conversationId } = req.params;
    const { page = 1, limit = 30 } = req.query;

    const result = await chatService.listMessages(conversationId, myUserId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[Chat Controller] List messages error:', error);
    return res.status(errorStatus(error)).json({
      success: false,
      message: error.message || 'Failed to load messages'
    });
  }
};

/**
 * POST /api/quiz/chat/conversations/:conversationId/messages
 * Body: { body }
 * REST fallback send — same role as POST /lobby/match/:id/answer for
 * answers. Persists via chatService.sendMessage (source of truth), then
 * still pushes over the socket so a connected recipient gets the live
 * update even though this arrived over REST.
 */
exports.sendMessage = async (req, res) => {
  try {
    const myUserId = req.user.id;
    const { conversationId } = req.params;
    const { body } = req.body;

    const quizInputSanitizer = require('../middleware/quizInputSanitizer');
    const validation = quizInputSanitizer.validateChatMessageInput({ body });
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.errors.join(', ') });
    }

    // quizRoutes.js skips its global entity-escaping sanitizer for this one
    // route (see the note there), so `body` arrives as the user typed it.
    // sanitizeChatMessage strips markup instead of encoding punctuation.
    const sanitizedBody = quizInputSanitizer.sanitizeChatMessage(body);
    const message = await chatService.sendMessage(conversationId, myUserId, sanitizedBody);

    try {
      const websocketManager = require('../services/websocketManager');
      websocketManager.sendOrQueue(message.recipientId, 'chat_message', {
        conversationId,
        message: { id: message.id, senderId: myUserId, body: message.body, createdAt: message.createdAt }
      });
      websocketManager.sendOrQueue(message.recipientId, 'chat_unread_update', { conversationId, delta: 1 });
    } catch (wsError) {
      console.error('[Chat Controller] Failed to push REST-sent message over socket:', wsError.message);
    }

    return res.status(201).json({
      success: true,
      message: { id: message.id, senderId: myUserId, body: message.body, createdAt: message.createdAt }
    });
  } catch (error) {
    console.error('[Chat Controller] Send message error:', error);
    return res.status(errorStatus(error)).json({
      success: false,
      message: error.message || 'Failed to send message'
    });
  }
};

/**
 * POST /api/quiz/chat/conversations/:conversationId/read
 */
exports.markConversationRead = async (req, res) => {
  try {
    const myUserId = req.user.id;
    const { conversationId } = req.params;

    const markedCount = await chatService.markConversationRead(conversationId, myUserId);
    return res.status(200).json({ success: true, markedCount });
  } catch (error) {
    console.error('[Chat Controller] Mark conversation read error:', error);
    return res.status(errorStatus(error)).json({
      success: false,
      message: error.message || 'Failed to mark conversation read'
    });
  }
};

/**
 * GET /api/quiz/chat/unread-count
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const myUserId = req.user.id;
    const unreadCount = await chatService.getUnreadCount(myUserId);
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    console.error('[Chat Controller] Get unread count error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load unread count' });
  }
};
