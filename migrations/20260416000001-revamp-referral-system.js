'use strict';

/**
 * Migration: Revamp Referral System
 *
 * Changes:
 * 1. Alter referral_codes — remove MVP columns, add partner/commission/expiry fields
 * 2. Create user_referrals — permanent creator-to-partner link table
 * 3. Alter referral_commissions — remove approval workflow, add content/currency fields
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // ── 1. Alter referral_codes ──────────────────────────────────────────────

    // Remove old MVP columns
    await queryInterface.removeColumn('referral_codes', 'series_id').catch(() => {});
    await queryInterface.removeColumn('referral_codes', 'user_id').catch(() => {});

    // Add new columns
    await queryInterface.addColumn('referral_codes', 'label', {
      type: Sequelize.STRING(200),
      allowNull: false,
      defaultValue: 'Partner Referral'
    });

    await queryInterface.addColumn('referral_codes', 'partner_user_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      references: { model: 'Users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    await queryInterface.addColumn('referral_codes', 'commission_percent', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 10.00
    });

    await queryInterface.addColumn('referral_codes', 'expires_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("NOW() + INTERVAL '3 months'")
    });

    await queryInterface.addColumn('referral_codes', 'status', {
      type: Sequelize.ENUM('active', 'inactive', 'expired'),
      allowNull: false,
      defaultValue: 'active'
    });

    await queryInterface.addColumn('referral_codes', 'created_by', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      references: { model: 'Users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    // Add indexes on new columns
    await queryInterface.addIndex('referral_codes', ['partner_user_id'], {
      name: 'idx_referral_codes_partner_user_id'
    });
    await queryInterface.addIndex('referral_codes', ['status'], {
      name: 'idx_referral_codes_status'
    });

    // ── 2. Create user_referrals ─────────────────────────────────────────────

    await queryInterface.createTable('user_referrals', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      creator_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      referral_code_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'referral_codes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      referral_code: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      partner_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      signed_up_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      commission_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      }
    });

    await queryInterface.addIndex('user_referrals', ['creator_user_id'], {
      name: 'idx_user_referrals_creator',
      unique: true
    });
    await queryInterface.addIndex('user_referrals', ['partner_user_id'], {
      name: 'idx_user_referrals_partner'
    });
    await queryInterface.addIndex('user_referrals', ['referral_code_id'], {
      name: 'idx_user_referrals_code_id'
    });

    // ── 3. Alter referral_commissions ────────────────────────────────────────

    // Remove old approval workflow columns
    const dropCols = ['series_id', 'coupon_code', 'status', 'approved_by', 'approved_at', 'paid_at', 'rejection_reason'];
    for (const col of dropCols) {
      await queryInterface.removeColumn('referral_commissions', col).catch(() => {});
    }

    // Add new columns
    await queryInterface.addColumn('referral_commissions', 'content_type', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'unknown'
    });

    await queryInterface.addColumn('referral_commissions', 'content_id', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    await queryInterface.addColumn('referral_commissions', 'commission_percent', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0
    });

    await queryInterface.addColumn('referral_commissions', 'purchase_amount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0
    });

    await queryInterface.addColumn('referral_commissions', 'currency', {
      type: Sequelize.STRING(3),
      allowNull: false,
      defaultValue: 'NGN'
    });

    // Add unique constraint on purchase_id for idempotency
    await queryInterface.addConstraint('referral_commissions', {
      fields: ['purchase_id'],
      type: 'unique',
      name: 'uq_referral_commissions_purchase_id'
    });

    await queryInterface.addIndex('referral_commissions', ['purchase_id'], {
      name: 'idx_referral_commissions_purchase'
    }).catch(() => {}); // may already exist

    await queryInterface.addIndex('referral_commissions', ['referrer_user_id'], {
      name: 'idx_referral_commissions_referrer'
    }).catch(() => {});

    console.log('✅ Referral system revamp migration complete');
  },

  down: async (queryInterface, Sequelize) => {
    // Reverse order

    // 3. Revert referral_commissions
    await queryInterface.removeConstraint('referral_commissions', 'uq_referral_commissions_purchase_id').catch(() => {});
    const revertCols = ['content_type', 'content_id', 'commission_percent', 'purchase_amount', 'currency'];
    for (const col of revertCols) {
      await queryInterface.removeColumn('referral_commissions', col).catch(() => {});
    }

    // 2. Drop user_referrals
    await queryInterface.dropTable('user_referrals');

    // 1. Revert referral_codes
    await queryInterface.removeIndex('referral_codes', 'idx_referral_codes_partner_user_id').catch(() => {});
    await queryInterface.removeIndex('referral_codes', 'idx_referral_codes_status').catch(() => {});
    const revertCodeCols = ['label', 'partner_user_id', 'commission_percent', 'expires_at', 'status', 'created_by'];
    for (const col of revertCodeCols) {
      await queryInterface.removeColumn('referral_codes', col).catch(() => {});
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_referral_codes_status";').catch(() => {});

    // Restore old columns
    await queryInterface.addColumn('referral_codes', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
    await queryInterface.addColumn('referral_codes', 'series_id', {
      type: Sequelize.UUID,
      allowNull: true
    });

    console.log('✅ Referral system revamp migration rolled back');
  }
};
