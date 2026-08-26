const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * ChatConversation Model
 *
 * One row per 1:1 conversation, keyed on a normalized (low, high) userId
 * pair so there's exactly one conversation regardless of who initiated
 * it — unlike QuizMatch there's no challenger/opponent asymmetry here.
 * last_message_* fields are denormalized so the conversation list can be
 * paged without aggregating ChatMessage on every call.
 */
const ChatConversation = sequelize.define('ChatConversation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userLowId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_low_id',
    references: { model: 'Users', key: 'id' }
  },
  userHighId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_high_id',
    references: { model: 'Users', key: 'id' }
  },
  lastMessageAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_message_at'
  },
  lastMessagePreview: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'last_message_preview'
  },
  lastMessageSenderId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'last_message_sender_id',
    references: { model: 'Users', key: 'id' }
  }
}, {
  tableName: 'chat_conversations',
  underscored: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

ChatConversation.associate = (models) => {
  ChatConversation.belongsTo(models.User, { foreignKey: 'userLowId', as: 'userLow' });
  ChatConversation.belongsTo(models.User, { foreignKey: 'userHighId', as: 'userHigh' });
  ChatConversation.belongsTo(models.User, { foreignKey: 'lastMessageSenderId', as: 'lastMessageSender' });
  ChatConversation.hasMany(models.ChatMessage, { foreignKey: 'conversationId', as: 'messages' });
};

module.exports = ChatConversation;
