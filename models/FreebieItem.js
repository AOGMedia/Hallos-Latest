const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * FreebieItem — a single item inside a Freebie bundle.
 * Can be either a file (uploaded to S3) or an external link.
 * itemType: 'file' | 'link'
 */
const FreebieItem = sequelize.define('FreebieItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  freebieId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'freebie_id',
    references: { model: 'freebies', key: 'id' },
    onDelete: 'CASCADE'
  },
  itemType: {
    type: DataTypes.ENUM('file', 'link'),
    allowNull: false,
    field: 'item_type',
    defaultValue: 'file'
  },
  // ── File fields (itemType = 'file') ──────────────────────────────────────
  fileName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'file_name',
    comment: 'Original filename as uploaded'
  },
  fileType: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'file_type',
    comment: 'MIME type e.g. application/pdf'
  },
  fileSize: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'file_size',
    comment: 'File size in bytes'
  },
  s3Key: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 's3_key',
    comment: 'S3 object key for deletion'
  },
  fileUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'file_url',
    comment: 'Public or signed S3 URL'
  },
  // ── Link fields (itemType = 'link') ──────────────────────────────────────
  linkUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'link_url',
    comment: 'External URL for link-type items'
  },
  linkTitle: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'link_title',
    comment: 'Display title for the link'
  },
  // ── Shared ───────────────────────────────────────────────────────────────
  downloadCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    field: 'download_count'
  },
  isFreePreview: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_free_preview'
  }
}, {
  tableName: 'freebie_items',
  timestamps: true,
  underscored: true
});

module.exports = FreebieItem;
