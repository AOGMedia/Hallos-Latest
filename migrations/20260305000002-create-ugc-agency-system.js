'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create companies table
    await queryInterface.createTable('companies', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      company_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      industry: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      website: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      contact_name: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      contact_email: {
        type: Sequelize.STRING(255),
        allowNull: false
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

    // Create collaboration_requests table
    await queryInterface.createTable('collaboration_requests', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      company_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'companies',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('sent', 'pending', 'responded', 'rejected'),
        allowNull: false,
        defaultValue: 'sent'
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

    // Add indexes for performance
    await queryInterface.addIndex('companies', ['industry'], {
      name: 'idx_companies_industry'
    });

    await queryInterface.addIndex('companies', ['company_name'], {
      name: 'idx_companies_name'
    });

    await queryInterface.addIndex('collaboration_requests', ['user_id'], {
      name: 'idx_collaboration_requests_user_id'
    });

    await queryInterface.addIndex('collaboration_requests', ['company_id'], {
      name: 'idx_collaboration_requests_company_id'
    });

    await queryInterface.addIndex('collaboration_requests', ['status'], {
      name: 'idx_collaboration_requests_status'
    });

    await queryInterface.addIndex('collaboration_requests', ['sent_at'], {
      name: 'idx_collaboration_requests_sent_at'
    });

    console.log('✅ UGC Agency system tables and indexes created successfully');
  },

  down: async (queryInterface, Sequelize) => {
    // Drop indexes
    await queryInterface.removeIndex('collaboration_requests', 'idx_collaboration_requests_sent_at');
    await queryInterface.removeIndex('collaboration_requests', 'idx_collaboration_requests_status');
    await queryInterface.removeIndex('collaboration_requests', 'idx_collaboration_requests_company_id');
    await queryInterface.removeIndex('collaboration_requests', 'idx_collaboration_requests_user_id');
    await queryInterface.removeIndex('companies', 'idx_companies_name');
    await queryInterface.removeIndex('companies', 'idx_companies_industry');

    // Drop tables
    await queryInterface.dropTable('collaboration_requests');
    await queryInterface.dropTable('companies');

    console.log('✅ UGC Agency system rolled back successfully');
  }
};
