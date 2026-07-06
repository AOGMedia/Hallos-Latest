'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create wallet_accounts table for multi-currency support
    const tableExists = await queryInterface.showAllTables().then(tables => 
      tables.includes('wallet_accounts')
    );
    
    if (!tableExists) {
      await queryInterface.createTable('wallet_accounts', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
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
        currency: {
          type: Sequelize.STRING(3),
          allowNull: false,
          validate: {
            isIn: [['NGN', 'USD']]
          }
        },
        balance_available: {
          type: Sequelize.BIGINT,
          allowNull: false,
          defaultValue: 0,
          comment: 'Stored in smallest currency unit (kobo/cents)'
        },
        balance_pending: {
          type: Sequelize.BIGINT,
          allowNull: false,
          defaultValue: 0,
          comment: 'Pending withdrawals in smallest currency unit'
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW
        }
      });

      // Add unique constraint for user_id + currency
      await queryInterface.addConstraint('wallet_accounts', {
        fields: ['user_id', 'currency'],
        type: 'unique',
        name: 'wallet_accounts_user_currency_unique'
      });

      // Create indexes for performance
      try {
        await queryInterface.addIndex('wallet_accounts', ['user_id']);
      } catch (error) {
        console.log('Index wallet_accounts_user_id already exists');
      }
      
      try {
        await queryInterface.addIndex('wallet_accounts', ['currency']);
      } catch (error) {
        console.log('Index wallet_accounts_currency already exists');
      }
    }

    // Create idempotency_keys table
    await queryInterface.createTable('idempotency_keys', {
      key: {
        type: Sequelize.UUID,
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
      operation_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      operation_data: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      result_data: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'processing'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP + INTERVAL '24 hours')")
      }
    });

      // Create indexes for idempotency keys
      try {
        await queryInterface.addIndex('idempotency_keys', ['user_id']);
      } catch (error) {
        console.log('Index idempotency_keys_user_id already exists');
      }
      
      try {
        await queryInterface.addIndex('idempotency_keys', ['expires_at']);
      } catch (error) {
        console.log('Index idempotency_keys_expires_at already exists');
      }
      
      try {
        await queryInterface.addIndex('idempotency_keys', ['operation_type']);
      } catch (error) {
        console.log('Index idempotency_keys_operation_type already exists');
      }

    // Create financial_transactions table
    await queryInterface.createTable('financial_transactions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'wallet_accounts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      transaction_type: {
        type: Sequelize.ENUM('credit', 'debit', 'transfer_in', 'transfer_out'),
        allowNull: false
      },
      amount: {
        type: Sequelize.BIGINT,
        allowNull: false,
        comment: 'Amount in smallest currency unit'
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false
      },
      reference: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('pending', 'completed', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending'
      },
      gateway: {
        type: Sequelize.ENUM('paystack', 'stripe'),
        allowNull: true
      },
      external_reference: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      idempotency_key: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    // Add indexes for financial transactions
    const financialIndexes = [
      ['wallet_id'],
      ['transaction_type'],
      ['currency'],
      ['status'],
      ['created_at'],
      ['idempotency_key']
    ];

    for (const fields of financialIndexes) {
      try {
        await queryInterface.addIndex('financial_transactions', fields);
      } catch (error) {
        console.log(`Index financial_transactions_${fields.join('_')} already exists`);
      }
    }

    // Create audit_logs table
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      operation_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      resource_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      resource_id: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      old_values: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      new_values: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      ip_address: {
        type: Sequelize.INET,
        allowNull: true
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      request_id: {
        type: Sequelize.UUID,
        allowNull: true
      },
      session_id: {
        type: Sequelize.UUID,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      hash_chain: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'For tamper detection'
      }
    });

    // Add indexes for audit logs
    const auditIndexes = [
      ['user_id'],
      ['operation_type'],
      ['resource_type'],
      ['created_at']
    ];

    for (const fields of auditIndexes) {
      try {
        await queryInterface.addIndex('audit_logs', fields);
      } catch (error) {
        console.log(`Index audit_logs_${fields.join('_')} already exists`);
      }
    }

    // Create withdrawal_limits table
    await queryInterface.createTable('withdrawal_limits', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
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
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false
      },
      daily_limit: {
        type: Sequelize.BIGINT,
        allowNull: false,
        comment: 'Daily limit in smallest currency unit'
      },
      monthly_limit: {
        type: Sequelize.BIGINT,
        allowNull: false,
        comment: 'Monthly limit in smallest currency unit'
      },
      daily_used: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0
      },
      monthly_used: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0
      },
      last_daily_reset: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_DATE')
      },
      last_monthly_reset: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        defaultValue: Sequelize.literal("DATE_TRUNC('month', CURRENT_DATE)::date")
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Add unique constraint for user_id + currency
    try {
      await queryInterface.addConstraint('withdrawal_limits', {
        fields: ['user_id', 'currency'],
        type: 'unique',
        name: 'withdrawal_limits_user_currency_unique'
      });
    } catch (error) {
      console.log('Constraint withdrawal_limits_user_currency_unique already exists');
    }

    // Add currency field to existing tables
    const videoTableInfo = await queryInterface.describeTable('videos');
    if (!videoTableInfo.currency) {
      await queryInterface.addColumn('videos', 'currency', {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'NGN'
      });
    }

    const liveClassTableInfo = await queryInterface.describeTable('live_classes');
    if (!liveClassTableInfo.currency) {
      await queryInterface.addColumn('live_classes', 'currency', {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'NGN'
      });
    }

    // Update existing wallets table to add currency if it doesn't exist
    const tableInfo = await queryInterface.describeTable('wallets');
    if (!tableInfo.currency) {
      await queryInterface.addColumn('wallets', 'currency', {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'NGN'
      });
    }

    // Create default withdrawal limits for existing users
    await queryInterface.sequelize.query(`
      INSERT INTO withdrawal_limits (id, user_id, currency, daily_limit, monthly_limit, last_daily_reset, last_monthly_reset, created_at)
      SELECT 
        gen_random_uuid(),
        id,
        'NGN',
        50000000, -- 500,000 NGN in kobo
        1000000000, -- 10,000,000 NGN in kobo
        CURRENT_DATE,
        DATE_TRUNC('month', CURRENT_DATE)::date,
        CURRENT_TIMESTAMP
      FROM "Users"
      WHERE NOT EXISTS (
        SELECT 1 FROM withdrawal_limits 
        WHERE withdrawal_limits.user_id = "Users".id 
        AND withdrawal_limits.currency = 'NGN'
      )
    `);

    await queryInterface.sequelize.query(`
      INSERT INTO withdrawal_limits (id, user_id, currency, daily_limit, monthly_limit, last_daily_reset, last_monthly_reset, created_at)
      SELECT 
        gen_random_uuid(),
        id,
        'USD',
        200000, -- $2,000 in cents
        5000000, -- $50,000 in cents
        CURRENT_DATE,
        DATE_TRUNC('month', CURRENT_DATE)::date,
        CURRENT_TIMESTAMP
      FROM "Users"
      WHERE NOT EXISTS (
        SELECT 1 FROM withdrawal_limits 
        WHERE withdrawal_limits.user_id = "Users".id 
        AND withdrawal_limits.currency = 'USD'
      )
    `);

    // Create wallet accounts for existing users
    await queryInterface.sequelize.query(`
      INSERT INTO wallet_accounts (id, user_id, currency, balance_available, balance_pending, created_at, updated_at)
      SELECT 
        gen_random_uuid(),
        id,
        'NGN',
        COALESCE((
          SELECT (total_earnings - withdrawn_amount - pending_amount) * 100
          FROM wallets 
          WHERE wallets.user_id = "Users".id
        ), 0),
        COALESCE((
          SELECT pending_amount * 100
          FROM wallets 
          WHERE wallets.user_id = "Users".id
        ), 0),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "Users"
      WHERE NOT EXISTS (
        SELECT 1 FROM wallet_accounts 
        WHERE wallet_accounts.user_id = "Users".id 
        AND wallet_accounts.currency = 'NGN'
      )
    `);

    await queryInterface.sequelize.query(`
      INSERT INTO wallet_accounts (id, user_id, currency, balance_available, balance_pending, created_at, updated_at)
      SELECT 
        gen_random_uuid(),
        id,
        'USD',
        0,
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "Users"
      WHERE NOT EXISTS (
        SELECT 1 FROM wallet_accounts 
        WHERE wallet_accounts.user_id = "Users".id 
        AND wallet_accounts.currency = 'USD'
      )
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Remove added columns
    await queryInterface.removeColumn('videos', 'currency');
    await queryInterface.removeColumn('live_classes', 'currency');

    // Drop tables in reverse order
    await queryInterface.dropTable('withdrawal_limits');
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('financial_transactions');
    await queryInterface.dropTable('idempotency_keys');
    await queryInterface.dropTable('wallet_accounts');
  }
};