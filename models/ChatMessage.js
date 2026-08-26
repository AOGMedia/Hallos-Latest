const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * ChatMessage Model
 *
 * Append-only — messages are immutable once sent (no updated_at, same
 * idiom as QuizInviteClaim). recipientId is a denormalized copy of "the
 * other participant" so the socket layer can push a delivered message
 * without joining back through ChatConversation first. body is persisted
 * only after quizInputSanitizer.sanitizeString() has run — never store an
 * unsanitized value here. readAt is null until the recipient marks the
 * conversation read (nullable-timestamp idiom, matching User.nicknameChangedAt
 * / feedbackDismissedAt — no boolean read-state precedent exists in this
 * codebase).
 */
const ChatMessage = sequelize.define('ChatMessage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  conversationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'conversation_id',
    references: { model: 'chat_conversations', key: 'id' }
  },
  senderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'sender_id',
    references: { model: 'Users', key: 'id' }
  },
  recipientId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'recipient_id',
    references: { model: 'Users', key: 'id' }
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { notEmpty: true, len: [1, 2000] }
  },
  readAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'read_at'
  }
}, {
  tableName: 'chat_messages',
  underscored: true,
  createdAt: 'created_at',
  updatedAt: false
});

ChatMessage.associate = (models) => {
  ChatMessage.belongsTo(models.ChatConversation, { foreignKey: 'conversationId', as: 'conversation' });
  ChatMessage.belongsTo(models.User, { foreignKey: 'senderId', as: 'sender' });
  ChatMessage.belongsTo(models.User, { foreignKey: 'recipientId', as: 'recipient' });
};

module.exports = ChatMessage;
