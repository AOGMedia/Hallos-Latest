'use strict';

/**
 * Migration: Create Chat Conversations Table
 *
 * One row per 1:1 conversation between two players, keyed on a
 * normalized (low, high) userId pair so there's exactly one conversation
 * per pair regardless of who started it — chat has no challenger/opponent
 * asymmetry the way a QuizMatch does. Denormalized last-message fields
 * keep the conversation list cheap to page without aggregating
 * chat_messages on every call.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    );

    await queryInterface.createTable('chat_conversations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      user_low_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      user_high_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      last_message_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      last_message_preview: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      last_message_sender_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' }
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    // Exactly one conversation per unordered pair — the target for an
    // idempotent "get or create" lookup.
    await queryInterface.addIndex('chat_conversations', ['user_low_id', 'user_high_id'], {
      name: 'idx_chat_conversations_pair_unique',
      unique: true
    });

    // "My conversations, newest first" from either side of the pair.
    await queryInterface.addIndex('chat_conversations', ['user_low_id', 'last_message_at'], {
      name: 'idx_chat_conversations_low_recency'
    });

    await queryInterface.addIndex('chat_conversations', ['user_high_id', 'last_message_at'], {
      name: 'idx_chat_conversations_high_recency'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('chat_conversations');
  }
};
