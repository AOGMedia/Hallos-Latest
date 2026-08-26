/**
 * Chat Models Index
 *
 * Sets up associations between Chat models. Kept separate from
 * quizIndex.js rather than folded into it, so chat's model wiring can be
 * reviewed/rolled back independently of the rest of the quiz product.
 */

const ChatConversation = require('./ChatConversation');
const ChatMessage = require('./ChatMessage');
const User = require('./User');

// ChatConversation associations
ChatConversation.belongsTo(User, {
  foreignKey: 'userLowId',
  as: 'userLow'
});

ChatConversation.belongsTo(User, {
  foreignKey: 'userHighId',
  as: 'userHigh'
});

ChatConversation.belongsTo(User, {
  foreignKey: 'lastMessageSenderId',
  as: 'lastMessageSender'
});

ChatConversation.hasMany(ChatMessage, {
  foreignKey: 'conversationId',
  as: 'messages'
});

// ChatMessage associations
ChatMessage.belongsTo(ChatConversation, {
  foreignKey: 'conversationId',
  as: 'conversation'
});

ChatMessage.belongsTo(User, {
  foreignKey: 'senderId',
  as: 'sender'
});

ChatMessage.belongsTo(User, {
  foreignKey: 'recipientId',
  as: 'recipient'
});

module.exports = {
  ChatConversation,
  ChatMessage
};
