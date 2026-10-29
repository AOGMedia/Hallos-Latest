const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * One gift sent to a host during a GetStream live class or series session.
 * The record of what was paid, what the host received and the platform fee.
 * Amounts are in the smallest unit (kobo/cents), like wallet_accounts.
 *
 * New table — created by sequelize.sync on boot (and by the matching
 * migration); nothing else reads or writes it.
 */
const LiveGift = sequelize.define('LiveGift', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  senderId: { type: DataTypes.INTEGER, allowNull: false, field: 'sender_id' },
  recipientId: { type: DataTypes.INTEGER, allowNull: false, field: 'recipient_id' },
  /** 'live_class' or 'live_session' */
  contentType: { type: DataTypes.STRING(20), allowNull: false, field: 'content_type' },
  contentId: { type: DataTypes.UUID, allowNull: false, field: 'content_id' },
  giftCode: { type: DataTypes.STRING(32), allowNull: false, field: 'gift_code' },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  amount: { type: DataTypes.BIGINT, allowNull: false },
  hostAmount: { type: DataTypes.BIGINT, allowNull: false, field: 'host_amount' },
  platformFee: { type: DataTypes.BIGINT, allowNull: false, field: 'platform_fee' },
  /** One per tap in the browser, so a retried request can't charge twice. */
  idempotencyKey: { type: DataTypes.STRING(100), allowNull: false, field: 'idempotency_key' }
}, {
  tableName: 'live_gifts',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['sender_id', 'idempotency_key'], name: 'live_gifts_sender_idempotency_unique' },
    { fields: ['content_type', 'content_id'], name: 'live_gifts_content_idx' },
    { fields: ['recipient_id'], name: 'live_gifts_recipient_idx' }
  ]
});

module.exports = LiveGift;
