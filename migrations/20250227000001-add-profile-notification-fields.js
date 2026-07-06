'use strict';

/**
 * Migration: Add Profile and Notification Fields
 * 
 * Adds fields to User model for:
 * - Profile enhancements (phone, country, bio, social links)
 * - Notification preferences
 * 
 * Also adds reminder_sent field to LiveSession model
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Adding profile and notification fields...');

      // Add fields to users table (without schema prefix)
      await queryInterface.addColumn('Users', 'phone_number', {
        type: Sequelize.STRING(20),
        allowNull: true
      }, { transaction });

      await queryInterface.addColumn('Users', 'country', {
        type: Sequelize.STRING(100),
        allowNull: true
      }, { transaction });

      await queryInterface.addColumn('Users', 'bio', {
        type: Sequelize.TEXT,
        allowNull: true
      }, { transaction });

      await queryInterface.addColumn('Users', 'social_links', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {}
      }, { transaction });

      await queryInterface.addColumn('Users', 'newsletter_subscribed', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      }, { transaction });

      console.log('✅ Added profile fields to users table');

      // Add reminder_sent field to live_sessions table
      await queryInterface.addColumn('live_sessions', 'reminder_sent', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      }, { transaction });

      console.log('✅ Added reminder_sent field to live_sessions table');

      // Create index for newsletter queries
      await queryInterface.addIndex('Users', ['newsletter_subscribed'], {
        name: 'idx_users_newsletter_subscribed',
        transaction
      });

      // Create index for reminder queries
      await queryInterface.addIndex('live_sessions', ['reminder_sent', 'scheduled_start_time'], {
        name: 'idx_live_sessions_reminder_scheduled',
        transaction
      });

      console.log('✅ Created indexes');

      await transaction.commit();
      console.log('✅ Migration completed successfully');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Migration failed:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('🔄 Reverting profile and notification fields...');

      // Remove indexes
      await queryInterface.removeIndex('Users', 'idx_users_newsletter_subscribed', { transaction });
      await queryInterface.removeIndex('live_sessions', 'idx_live_sessions_reminder_scheduled', { transaction });

      // Remove fields from users table
      await queryInterface.removeColumn('Users', 'phone_number', { transaction });
      await queryInterface.removeColumn('Users', 'country', { transaction });
      await queryInterface.removeColumn('Users', 'bio', { transaction });
      await queryInterface.removeColumn('Users', 'social_links', { transaction });
      await queryInterface.removeColumn('Users', 'newsletter_subscribed', { transaction });

      // Remove field from live_sessions table
      await queryInterface.removeColumn('live_sessions', 'reminder_sent', { transaction });

      await transaction.commit();
      console.log('✅ Rollback completed successfully');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }
};
