'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('wallets', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        unique: true,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      total_earnings: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00
      },
      withdrawn_amount: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00
      },
      pending_amount: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'NGN'
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

    // Add index
    await queryInterface.addIndex('wallets', ['user_id'], {
      name: 'idx_wallets_user'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('wallets');
  }
};
