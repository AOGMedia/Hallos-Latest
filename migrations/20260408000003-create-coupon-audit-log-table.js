'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create coupon_audit_log table
    await queryInterface.createTable('coupon_audit_log', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      coupon_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'coupons',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      action_type: {
        type: Sequelize.ENUM('create', 'update', 'delete', 'activate', 'deactivate'),
        allowNull: false
      },
      old_values: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      new_values: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('coupon_audit_log');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_coupon_audit_log_action_type";');
  }
};
