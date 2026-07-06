'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('campaign_registrations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      first_name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      last_name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      phone_number: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      location: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nigerian state or city of residence'
      },
      talent: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Selected talent/skill area from dropdown'
      },
      job_description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      what_to_learn: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      payment_reference: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true
      },
      payment_status: {
        type: Sequelize.ENUM('pending', 'completed', 'failed'),
        defaultValue: 'pending'
      },
      payment_gateway: {
        type: Sequelize.STRING(20),
        defaultValue: 'paystack'
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 2000.00
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'NGN'
      },
      email_sent: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
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

    await queryInterface.addIndex('campaign_registrations', ['email']);
    await queryInterface.addIndex('campaign_registrations', ['payment_status']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('campaign_registrations');
  }
};
