'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('withdrawal_otps', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      
      withdrawalId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        comment: 'Unique withdrawal identifier'
      },
      
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'User who initiated the withdrawal'
      },
      
      code: {
        type: Sequelize.STRING(6),
        allowNull: false,
        comment: '6-digit OTP code'
      },
      
      amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        comment: 'Withdrawal amount'
      },
      
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        comment: 'Currency code (NGN, USD)'
      },
      
      bankAccount: {
        type: Sequelize.JSON,
        allowNull: false,
        comment: 'Bank account details for withdrawal'
      },
      
      reference: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Withdrawal reference'
      },
      
      attempts: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        comment: 'Number of verification attempts'
      },
      
      maxAttempts: {
        type: Sequelize.INTEGER,
        defaultValue: 3,
        comment: 'Maximum allowed attempts'
      },
      
      status: {
        type: Sequelize.ENUM('pending', 'verified', 'expired', 'failed'),
        defaultValue: 'pending',
        comment: 'OTP status'
      },
      
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'OTP expiration time'
      },
      
      verifiedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'When OTP was successfully verified'
      },
      
      lastResendAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Last time OTP was resent'
      },
      
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Add indexes
    await queryInterface.addIndex('withdrawal_otps', ['withdrawalId'], {
      unique: true,
      name: 'withdrawal_otps_withdrawal_id_unique'
    });
    
    await queryInterface.addIndex('withdrawal_otps', ['userId'], {
      name: 'withdrawal_otps_user_id_index'
    });
    
    await queryInterface.addIndex('withdrawal_otps', ['status'], {
      name: 'withdrawal_otps_status_index'
    });
    
    await queryInterface.addIndex('withdrawal_otps', ['expiresAt'], {
      name: 'withdrawal_otps_expires_at_index'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('withdrawal_otps');
  }
};