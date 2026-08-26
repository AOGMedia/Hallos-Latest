'use strict';

/**
 * Migration: Create Chat Messages Table
 *
 * Append-only — messages are immutable once sent (no updated_at). Bodies
 * are persisted only after quizInputSanitizer.sanitizeString() has run, so
 * this column is safe to render as-is on the way back out. recipient_id is
 * a denormalized copy of "the other participant" so the socket layer can
 * push a message without joining back through chat_conversations first.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('chat_messages', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      conversation_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'chat_conversations', key: 'id' },
        onDelete: 'CASCADE'
      },
      sender_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      recipient_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'null = unread'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    // Paginated history for a conversation, chronological.
    await queryInterface.addIndex('chat_messages', ['conversation_id', 'created_at'], {
      name: 'idx_chat_messages_conversation_created'
    });

    // Fast unread-count aggregation for the sidebar badge + per-conversation counts.
    await queryInterface.addIndex('chat_messages', ['recipient_id', 'read_at'], {
      name: 'idx_chat_messages_recipient_unread'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('chat_messages');
  }
};
