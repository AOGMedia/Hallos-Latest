'use strict';

/**
 * Migration: Fix video_views.user_id type from UUID to INTEGER
 * 
 * The user_id should be INTEGER to match the Users table id column
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('Fixing video_views.user_id column type...');

      // Step 1: Drop existing data (if any) since UUID can't convert to INTEGER
      console.log('Step 1: Clearing existing video_views data...');
      await queryInterface.sequelize.query(`
        TRUNCATE TABLE video_views CASCADE;
      `, { transaction });

      // Step 2: Change column type from UUID to INTEGER with explicit casting
      console.log('Step 2: Changing user_id column type to INTEGER...');
      await queryInterface.sequelize.query(`
        ALTER TABLE video_views 
        ALTER COLUMN user_id TYPE INTEGER USING user_id::text::integer;
      `, { transaction });

      await transaction.commit();
      console.log('✅ Migration completed successfully!');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Migration failed:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      console.log('Rolling back: Changing user_id back to UUID...');

      await queryInterface.sequelize.query(`
        TRUNCATE TABLE video_views CASCADE;
      `, { transaction });

      await queryInterface.changeColumn('video_views', 'user_id', {
        type: Sequelize.UUID,
        allowNull: true
      }, { transaction });

      await transaction.commit();
      console.log('✅ Rollback completed successfully!');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }
};
