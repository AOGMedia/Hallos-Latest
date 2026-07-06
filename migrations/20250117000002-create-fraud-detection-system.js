'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create fraud_rules table
    await queryInterface.createTable('fraud_rules', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      rule_name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      rule_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      conditions: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      action: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Create fraud_alerts table
    await queryInterface.createTable('fraud_alerts', {
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
      transaction_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'financial_transactions',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      rule_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'fraud_rules',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      risk_score: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      alert_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('open', 'investigating', 'resolved', 'false_positive'),
        allowNull: false,
        defaultValue: 'open'
      },
      reviewed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Create manual_review_queue table
    await queryInterface.createTable('manual_review_queue', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      transaction_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'financial_transactions',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
      review_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      assigned_to: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      status: {
        type: Sequelize.ENUM('pending', 'in_review', 'approved', 'rejected', 'escalated'),
        allowNull: false,
        defaultValue: 'pending'
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      resolution: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    // Create webhook_events table
    await queryInterface.createTable('webhook_events', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      gateway: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      event_type: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      event_id: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      signature: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      processed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      processing_attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      last_processing_error: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      processed_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    // Add unique constraint for gateway + event_id
    try {
      await queryInterface.addConstraint('webhook_events', {
        fields: ['gateway', 'event_id'],
        type: 'unique',
        name: 'webhook_events_gateway_event_unique'
      });
    } catch (error) {
      console.log('Constraint webhook_events_gateway_event_unique already exists');
    }

    // Create bank_accounts table
    await queryInterface.createTable('bank_accounts', {
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
      bank_name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      account_number: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      account_name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      routing_number: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'For international transfers'
      },
      swift_code: {
        type: Sequelize.STRING(11),
        allowNull: true,
        comment: 'For international transfers'
      },
      bank_code: {
        type: Sequelize.STRING(10),
        allowNull: true,
        comment: 'For Nigerian banks'
      },
      is_verified: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Add indexes for performance
    const indexesToCreate = [
      { table: 'fraud_rules', fields: ['rule_type'] },
      { table: 'fraud_rules', fields: ['is_active'] },
      { table: 'fraud_alerts', fields: ['user_id'] },
      { table: 'fraud_alerts', fields: ['status'] },
      { table: 'fraud_alerts', fields: ['created_at'] },
      { table: 'manual_review_queue', fields: ['status'] },
      { table: 'manual_review_queue', fields: ['priority'] },
      { table: 'manual_review_queue', fields: ['assigned_to'] },
      { table: 'webhook_events', fields: ['gateway'] },
      { table: 'webhook_events', fields: ['processed'] },
      { table: 'webhook_events', fields: ['created_at'] },
      { table: 'bank_accounts', fields: ['user_id'] },
      { table: 'bank_accounts', fields: ['currency'] },
      { table: 'bank_accounts', fields: ['is_active'] }
    ];

    for (const indexInfo of indexesToCreate) {
      try {
        await queryInterface.addIndex(indexInfo.table, indexInfo.fields);
      } catch (error) {
        console.log(`Index ${indexInfo.table}_${indexInfo.fields.join('_')} already exists`);
      }
    }

    // Insert default fraud rules
    await queryInterface.bulkInsert('fraud_rules', [
      {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        rule_name: 'High Velocity Withdrawals',
        rule_type: 'velocity_check',
        conditions: JSON.stringify({
          operation: 'withdrawal',
          timeWindow: '1h',
          maxCount: 5,
          currency: 'any'
        }),
        action: 'flag_for_review',
        is_active: true,
        created_at: new Date()
      },
      {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
        rule_name: 'Large Amount Withdrawal',
        rule_type: 'amount_check',
        conditions: JSON.stringify({
          operation: 'withdrawal',
          thresholds: {
            NGN: 100000000, // 1M NGN in kobo
            USD: 500000     // $5000 in cents
          }
        }),
        action: 'require_manual_review',
        is_active: true,
        created_at: new Date()
      },
      {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d481',
        rule_name: 'New Bank Account Usage',
        rule_type: 'behavior_check',
        conditions: JSON.stringify({
          operation: 'withdrawal',
          checkNewBankAccount: true,
          gracePeriod: '24h'
        }),
        action: 'flag_for_review',
        is_active: true,
        created_at: new Date()
      },
      {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d482',
        rule_name: 'Unusual Time Pattern',
        rule_type: 'time_pattern',
        conditions: JSON.stringify({
          operation: 'withdrawal',
          unusualHours: [0, 1, 2, 3, 4, 5], // 12AM - 5AM
          timezone: 'Africa/Lagos'
        }),
        action: 'increase_monitoring',
        is_active: true,
        created_at: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop tables in reverse order
    await queryInterface.dropTable('bank_accounts');
    await queryInterface.dropTable('webhook_events');
    await queryInterface.dropTable('manual_review_queue');
    await queryInterface.dropTable('fraud_alerts');
    await queryInterface.dropTable('fraud_rules');
  }
};