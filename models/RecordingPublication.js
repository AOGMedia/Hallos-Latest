const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * A GetStream class recording the creator published as a Hallos video.
 * One row per recording file, so the same recording can't be published twice.
 * The video itself is an ordinary row in `videos` (imported into Mux).
 *
 * New table — created by sequelize.sync on boot (and by the matching
 * migration); the videos table is not changed.
 */
const RecordingPublication = sequelize.define('RecordingPublication', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  /** 'class' (live class) or 'session' (live series session) */
  sourceType: { type: DataTypes.STRING(16), allowNull: false, field: 'source_type' },
  sourceId: { type: DataTypes.STRING(64), allowNull: false, field: 'source_id' },
  /** GetStream recording filename — stable, unlike its signed URL. */
  filename: { type: DataTypes.STRING(512), allowNull: false },
  videoId: { type: DataTypes.UUID, allowNull: false, field: 'video_id' },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' }
}, {
  tableName: 'recording_publications',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['source_type', 'source_id', 'filename'],
      name: 'recording_publications_source_file_unique'
    },
    { fields: ['video_id'], name: 'recording_publications_video_idx' }
  ]
});

module.exports = RecordingPublication;
