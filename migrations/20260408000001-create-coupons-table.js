'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create coupons table
    await queryInterface.createTable('coupons', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true
      },
      type: {
        type: Sequelize.ENUM('partner', 'creator'),
        allowNull: false
      },
      discount_type: {
        type: Sequelize.ENUM('percentage', 'flat'),
        allowNull: false
      },
      discount_value: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      partner_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      partner_commission_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true
      },
      creator_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      applicable_content_types: {
        type: Sequelize.ARRAY(Sequelize.TEXT),
        allowNull: false,
        defaultValue: []
      },
      specific_content_ids: {
        type: Sequelize.ARRAY(Sequelize.TEXT),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'expired'),
        allowNull: false,
        defaultValue: 'active'
      },
      usage_limit: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      usage_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      starts_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Add CHECK constraints
    await queryInterface.sequelize.query(`
      ALTER TABLE coupons
      ADD CONSTRAINT valid_partner_coupon CHECK (
        (type = 'partner' AND partner_user_id IS NOT NULL AND partner_commission_percent IS NOT NULL AND creator_id IS NULL)
        OR
        (type = 'creator' AND creator_id IS NOT NULL AND partner_user_id IS NULL AND partner_commission_percent IS NULL)
      )
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE coupons
      ADD CONSTRAINT valid_date_range CHECK (
        starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at
      )
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE coupons
      ADD CONSTRAINT valid_usage_limit CHECK (
        usage_limit IS NULL OR usage_count <= usage_limit
      )
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE coupons
      ADD CONSTRAINT valid_percentage_discount CHECK (
        discount_type != 'percentage' OR (discount_value >= 0 AND discount_value <= 100)
      )
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop table
    await queryInterface.dropTable('coupons');

    // Drop enums
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_coupons_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_coupons_discount_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_coupons_status";');
  }
};
