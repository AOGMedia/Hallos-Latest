'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('payouts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
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
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      platform_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      gateway_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      net_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'NGN'
      },
      payment_gateway: {
        type: Sequelize.ENUM('paystack', 'stripe'),
        allowNull: false
      },
      bank_name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      account_number: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      account_name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      transfer_reference: {
        type: Sequelize.STRING(255),
        unique: true,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
        defaultValue: 'pending'
      },
      failure_reason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // Add indexes
    await queryInterface.addIndex('payouts', ['user_id'], {
      name: 'idx_payouts_user'
    });
    
    await queryInterface.addIndex('payouts', ['status'], {
      name: 'idx_payouts_status'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('payouts');
  }
};
