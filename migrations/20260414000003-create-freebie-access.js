'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('🔄 Creating freebie_access table...');

    await queryInterface.createTable('freebie_access', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()')
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
      freebie_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'freebies',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      purchase_reference: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Payment gateway reference for this purchase'
      },
      amount_paid: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Amount charged at the gateway (post-coupon price)'
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        comment: 'Currency used for the purchase (NGN or USD)'
      },
      coupon_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'coupons',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Coupon applied to this purchase, if any'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    console.log('✅ Created freebie_access table');

    // Unique constraint on (user_id, freebie_id)
    await queryInterface.addConstraint('freebie_access', {
      fields: ['user_id', 'freebie_id'],
      type: 'unique',
      name: 'uq_freebie_access_user_freebie'
    });

    console.log('✅ Added unique constraint on (user_id, freebie_id)');

    // Index on user_id
    await queryInterface.addIndex('freebie_access', ['user_id'], {
      name: 'idx_freebie_access_user_id'
    });

    // Index on freebie_id
    await queryInterface.addIndex('freebie_access', ['freebie_id'], {
      name: 'idx_freebie_access_freebie_id'
    });

    console.log('✅ Added indexes on user_id and freebie_id');
    console.log('✅ Migration completed successfully!');
  },

  down: async (queryInterface, Sequelize) => {
    console.log('🔄 Dropping freebie_access table...');

    await queryInterface.dropTable('freebie_access');
    console.log('✅ Dropped freebie_access table');

    console.log('✅ Rollback completed successfully!');
  }
};
