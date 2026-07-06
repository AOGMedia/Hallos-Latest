const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  firstname: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  lastname: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true, // Password is not required for OAuth
  },
  role: {
    type: DataTypes.STRING,
    defaultValue: 'viewer',
  },
  phoneNumber: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'phone_number'
  },
  country: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  socialLinks: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
    field: 'social_links'
  },
  newsletterSubscribed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'newsletter_subscribed'
  },
  feedbackSubmitted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'feedback_submitted'
  },
  feedbackDismissedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'feedback_dismissed_at'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  hooks: {
    afterCreate: async (user, options) => {
      try {
        console.log(`[User Hook] Creating wallets for new user ${user.id} (${user.email})`);
        
        // Import wallet service
        const { getOrCreateWallet } = require('../services/walletService');
        
        // Create NGN and USD wallets for the new user
        await getOrCreateWallet(user.id, 'NGN');
        await getOrCreateWallet(user.id, 'USD');
        
        console.log(`[User Hook] ✅ Wallets created successfully for user ${user.id}`);
      } catch (error) {
        console.error(`[User Hook] ❌ Failed to create wallets for user ${user.id}:`, error.message);
        // Don't throw error - user creation should succeed even if wallet creation fails
        // Wallets can be created later via the initialize endpoint
      }
    }
  }
});

module.exports = User;