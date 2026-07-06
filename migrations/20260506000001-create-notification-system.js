'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {

    // 1. notification_preferences — per-user granular settings
    await queryInterface.createTable('notification_preferences', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      instant_live_class_emails: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      daily_digest_emails: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      weekly_digest_emails: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      allow_creator_related_only: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      disable_all_emails: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('notification_preferences', ['user_id'], {
      name: 'idx_notification_preferences_user_id'
    });

    // 2. notification_logs — deduplication + audit trail
    await queryInterface.createTable('notification_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      content_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      content_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      notification_type: {
        type: Sequelize.ENUM('instant', 'daily_digest', 'weekly_digest', 'reminder'),
        allowNull: false
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('notification_logs', ['user_id', 'content_id', 'notification_type'], {
      name: 'idx_notification_logs_dedup',
      unique: true
    });
    await queryInterface.addIndex('notification_logs', ['content_id'], {
      name: 'idx_notification_logs_content_id'
    });

    // 3. digest_queue — pending digest items per user
    await queryInterface.createTable('digest_queue', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      content_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      content_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      digest_type: {
        type: Sequelize.ENUM('daily', 'weekly'),
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'sent', 'skipped'),
        allowNull: false,
        defaultValue: 'pending'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('digest_queue', ['user_id', 'status', 'digest_type'], {
      name: 'idx_digest_queue_user_status'
    });
    await queryInterface.addIndex('digest_queue', ['content_id'], {
      name: 'idx_digest_queue_content_id'
    });
    // Prevent duplicate queue entries
    await queryInterface.addIndex('digest_queue', ['user_id', 'content_id', 'digest_type'], {
      unique: true,
      name: 'idx_digest_queue_unique'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('digest_queue');
    await queryInterface.dropTable('notification_logs');
    await queryInterface.dropTable('notification_preferences');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_notification_logs_notification_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_digest_queue_digest_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_digest_queue_status";');
  }
};
