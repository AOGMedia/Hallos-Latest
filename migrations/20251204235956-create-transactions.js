'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('transactions', {
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
      transaction_type: {
        type: Sequelize.ENUM('purchase', 'payout', 'fee'),
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
      reference_type: {
        type: Sequelize.STRING(20),
        allowNull: true
      },
      reference_id: {
        type: Sequelize.UUID,
        allowNull: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // Add indexes
    await queryInterface.addIndex('transactions', ['user_id'], {
      name: 'idx_transactions_user'
    });
    
    await queryInterface.addIndex('transactions', ['transaction_type'], {
      name: 'idx_transactions_type'
    });
    
    await queryInterface.addIndex('transactions', ['reference_type', 'reference_id'], {
      name: 'idx_transactions_reference'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('transactions');
  }
};
