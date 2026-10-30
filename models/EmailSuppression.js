const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const EmailSuppression = sequelize.define('EmailSuppression', {
  email: {
    type: DataTypes.STRING(255),
    primaryKey: true,
    allowNull: false,
    set(value) {
      this.setDataValue('email', String(value).trim().toLowerCase());
    }
  },
  reason: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'unsubscribed'
  }
}, {
  tableName: 'email_suppressions',
  timestamps: true,
  updatedAt: false,
  underscored: true
});

module.exports = EmailSuppression;
