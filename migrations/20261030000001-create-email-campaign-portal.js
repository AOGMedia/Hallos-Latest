'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes('email_campaigns')) {
      await queryInterface.createTable('email_campaigns', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
        name: { type: Sequelize.STRING(150), allowNull: false },
        subject: { type: Sequelize.STRING(255), allowNull: false },
        preheader: { type: Sequelize.STRING(255), allowNull: true },
        body_html: { type: Sequelize.TEXT, allowNull: false },
        audience: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'draft' },
        scheduled_for: { type: Sequelize.DATE, allowNull: true },
        started_at: { type: Sequelize.DATE, allowNull: true },
        completed_at: { type: Sequelize.DATE, allowNull: true },
        total_recipients: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_by: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('email_campaigns', ['status'], { name: 'email_campaigns_status_idx' });
      await queryInterface.addIndex('email_campaigns', ['created_at'], { name: 'email_campaigns_created_at_idx' });
    }

    if (!tables.includes('email_campaign_recipients')) {
      await queryInterface.createTable('email_campaign_recipients', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
        campaign_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'email_campaigns', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        user_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        email: { type: Sequelize.STRING(255), allowNull: false },
        first_name: { type: Sequelize.STRING(255), allowNull: true },
        last_name: { type: Sequelize.STRING(255), allowNull: true },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        error: { type: Sequelize.TEXT, allowNull: true },
        message_id: { type: Sequelize.STRING(255), allowNull: true },
        sent_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('email_campaign_recipients', ['campaign_id', 'status'], {
        name: 'email_campaign_recipients_campaign_status_idx'
      });
      await queryInterface.addIndex('email_campaign_recipients', ['campaign_id', 'email'], {
        unique: true,
        name: 'email_campaign_recipients_campaign_email_unique'
      });
      await queryInterface.addIndex('email_campaign_recipients', ['status', 'sent_at'], {
        name: 'email_campaign_recipients_status_sent_at_idx'
      });
      await queryInterface.addIndex('email_campaign_recipients', ['user_id'], {
        name: 'email_campaign_recipients_user_idx'
      });
    }

    if (!tables.includes('email_suppressions')) {
      await queryInterface.createTable('email_suppressions', {
        email: { type: Sequelize.STRING(255), primaryKey: true, allowNull: false },
        reason: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'unsubscribed' },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('email_campaign_recipients');
    await queryInterface.dropTable('email_campaigns');
    await queryInterface.dropTable('email_suppressions');
  }
};
