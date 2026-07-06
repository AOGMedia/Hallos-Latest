'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Indexes for coupons table
    await queryInterface.addIndex('coupons', ['code'], {
      name: 'idx_coupons_code_upper',
      unique: true
    });

    await queryInterface.addIndex('coupons', ['status'], {
      name: 'idx_coupons_status'
    });

    await queryInterface.addIndex('coupons', ['type'], {
      name: 'idx_coupons_type'
    });

    await queryInterface.addIndex('coupons', ['creator_id'], {
      name: 'idx_coupons_creator_id'
    });

    await queryInterface.addIndex('coupons', ['partner_user_id'], {
      name: 'idx_coupons_partner_user_id'
    });

    await queryInterface.addIndex('coupons', ['expires_at'], {
      name: 'idx_coupons_expires_at',
      where: { status: 'active' }
    });

    await queryInterface.sequelize.query(`
      CREATE INDEX idx_coupons_applicable_content_types 
      ON coupons USING GIN (applicable_content_types)
    `);

    // Indexes for coupon_usage table
    await queryInterface.addIndex('coupon_usage', ['coupon_id'], {
      name: 'idx_coupon_usage_coupon_id'
    });

    await queryInterface.addIndex('coupon_usage', ['user_id'], {
      name: 'idx_coupon_usage_user_id'
    });

    await queryInterface.addIndex('coupon_usage', ['purchase_id'], {
      name: 'idx_coupon_usage_purchase_id'
    });

    await queryInterface.addIndex('coupon_usage', ['created_at'], {
      name: 'idx_coupon_usage_created_at',
      order: [['created_at', 'DESC']]
    });

    await queryInterface.addIndex('coupon_usage', ['content_type', 'content_id'], {
      name: 'idx_coupon_usage_content'
    });

    await queryInterface.addIndex('coupon_usage', ['currency'], {
      name: 'idx_coupon_usage_currency'
    });

    // Indexes for coupon_audit_log table
    await queryInterface.addIndex('coupon_audit_log', ['coupon_id'], {
      name: 'idx_coupon_audit_log_coupon_id'
    });

    await queryInterface.addIndex('coupon_audit_log', ['user_id'], {
      name: 'idx_coupon_audit_log_user_id'
    });

    await queryInterface.addIndex('coupon_audit_log', ['created_at'], {
      name: 'idx_coupon_audit_log_created_at',
      order: [['created_at', 'DESC']]
    });

    // Index for purchases table
    await queryInterface.addIndex('purchases', ['coupon_id'], {
      name: 'idx_purchases_coupon_id'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove coupons indexes
    await queryInterface.removeIndex('coupons', 'idx_coupons_code_upper');
    await queryInterface.removeIndex('coupons', 'idx_coupons_status');
    await queryInterface.removeIndex('coupons', 'idx_coupons_type');
    await queryInterface.removeIndex('coupons', 'idx_coupons_creator_id');
    await queryInterface.removeIndex('coupons', 'idx_coupons_partner_user_id');
    await queryInterface.removeIndex('coupons', 'idx_coupons_expires_at');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_coupons_applicable_content_types');

    // Remove coupon_usage indexes
    await queryInterface.removeIndex('coupon_usage', 'idx_coupon_usage_coupon_id');
    await queryInterface.removeIndex('coupon_usage', 'idx_coupon_usage_user_id');
    await queryInterface.removeIndex('coupon_usage', 'idx_coupon_usage_purchase_id');
    await queryInterface.removeIndex('coupon_usage', 'idx_coupon_usage_created_at');
    await queryInterface.removeIndex('coupon_usage', 'idx_coupon_usage_content');
    await queryInterface.removeIndex('coupon_usage', 'idx_coupon_usage_currency');

    // Remove coupon_audit_log indexes
    await queryInterface.removeIndex('coupon_audit_log', 'idx_coupon_audit_log_coupon_id');
    await queryInterface.removeIndex('coupon_audit_log', 'idx_coupon_audit_log_user_id');
    await queryInterface.removeIndex('coupon_audit_log', 'idx_coupon_audit_log_created_at');

    // Remove purchases index
    await queryInterface.removeIndex('purchases', 'idx_purchases_coupon_id');
  }
};
