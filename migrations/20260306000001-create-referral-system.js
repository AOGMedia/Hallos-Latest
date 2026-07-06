'use strict';

/**
 * Migration: Create Referral System
 * 
 * Creates tables for referral tracking:
 * - referral_codes: Stores unique referral codes per user
 * - referral_commissions: Tracks commissions from referrals
 * 
 * MVP Version: Hardcoded for Video Editing class + SaveBig10
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Enable UUID extension if not already enabled
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    );

    // Table 1: referral_codes
    await queryInterface.createTable('referral_codes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      referral_code: {
        type: Sequelize.STRING(20),
        unique: true,
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
      series_id: {
        type: Sequelize.UUID,
        allowNull: false,
        comment: 'Live series ID (Video Editing)'
      },
      clicks_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      successful_referrals: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      total_earnings: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      last_used_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    // Table 2: referral_commissions
    await queryInterface.createTable('referral_commissions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()'),
        primaryKey: true,
        allowNull: false
      },
      referral_code: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      referrer_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'User who shared the link'
      },
      referee_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'User who made the purchase'
      },
      purchase_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'purchases',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      series_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      coupon_code: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      commission_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Amount in NGN (2500)'
      },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'paid'),
        defaultValue: 'pending',
        allowNull: false
      },
      purchased_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      approved_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      approved_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      paid_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      rejection_reason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    // Indexes for referral_codes
    await queryInterface.addIndex('referral_codes', ['user_id'], {
      name: 'idx_referral_codes_user_id'
    });
    await queryInterface.addIndex('referral_codes', ['referral_code'], {
      name: 'idx_referral_codes_code',
      unique: true
    });
    await queryInterface.addIndex('referral_codes', ['series_id'], {
      name: 'idx_referral_codes_series_id'
    });

    // Indexes for referral_commissions
    await queryInterface.addIndex('referral_commissions', ['referrer_user_id'], {
      name: 'idx_referral_commissions_referrer'
    });
    await queryInterface.addIndex('referral_commissions', ['referee_user_id'], {
      name: 'idx_referral_commissions_referee'
    });
    await queryInterface.addIndex('referral_commissions', ['status'], {
      name: 'idx_referral_commissions_status'
    });
    await queryInterface.addIndex('referral_commissions', ['purchase_id'], {
      name: 'idx_referral_commissions_purchase'
    });
    await queryInterface.addIndex('referral_commissions', ['referral_code'], {
      name: 'idx_referral_commissions_code'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('referral_commissions');
    await queryInterface.dropTable('referral_codes');
  }
};
