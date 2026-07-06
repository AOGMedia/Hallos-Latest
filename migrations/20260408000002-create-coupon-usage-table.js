'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create coupon_usage table
    await queryInterface.createTable('coupon_usage', {
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
        onDelete: 'RESTRICT'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      purchase_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'purchases',
          key: 'id'
        },
        onDelete: 'RESTRICT'
      },
      original_price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      discount_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      final_price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      partner_commission_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      content_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      content_id: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add CHECK constraints
    await queryInterface.sequelize.query(`
      ALTER TABLE coupon_usage
      ADD CONSTRAINT valid_prices CHECK (
        original_price >= 0 AND
        discount_amount >= 0 AND
        final_price >= 0 AND
        discount_amount <= original_price AND
        final_price = original_price - discount_amount
      )
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE coupon_usage
      ADD CONSTRAINT valid_partner_commission CHECK (
        partner_commission_amount IS NULL OR partner_commission_amount >= 0
      )
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('coupon_usage');
  }
};
