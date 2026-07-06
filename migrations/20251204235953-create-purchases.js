'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('purchases', {
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
      content_type: {
        type: Sequelize.ENUM('video', 'live_class'),
        allowNull: false
      },
      content_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      amount: {
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
      payment_reference: {
        type: Sequelize.STRING(255),
        unique: true,
        allowNull: false
      },
      payment_status: {
        type: Sequelize.ENUM('pending', 'completed', 'failed'),
        defaultValue: 'pending'
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
    await queryInterface.addIndex('purchases', ['user_id'], {
      name: 'idx_purchases_user'
    });
    
    await queryInterface.addIndex('purchases', ['content_type', 'content_id'], {
      name: 'idx_purchases_content'
    });
    
    await queryInterface.addIndex('purchases', ['payment_reference'], {
      name: 'idx_purchases_reference'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('purchases');
  }
};
