/**
 * Publishing GetStream class recordings as Hallos videos.
 *
 * The creator picks a recording and fills in the video details; Mux imports
 * the file straight from GetStream (nothing is downloaded or re-uploaded by
 * the creator) and the result is an ordinary row in `videos`, sold and played
 * like any upload. Normal uploads are untouched: they go through a Mux upload
 * (upload_id), these are assets created from a URL and tagged with a
 * passthrough, so the two never match each other's webhook handling.
 */

const { Op, UniqueConstraintError } = require('sequelize');
const Video = require('../models/Video');
const RecordingPublication = require('../models/RecordingPublication');
const { GetStreamError } = require('./getStreamService');

const PASSTHROUGH_PREFIX = 'hallos-recording:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRICE = 10_000_000;
/** How many still-processing videos one recordings request re-checks with Mux. */
const MAX_STATUS_CHECKS = 5;

const mux = () => require('../config/mux');

const muxThumbnail = (playbackId) => `https://image.mux.com/${playbackId}/thumbnail.jpg?time=15`;

/** Video details from the request body, or a 400 with a clear message. */
const parseDetails = (body = {}) => {
  const title = String(body.title || '').trim();
  if (!title) throw new GetStreamError('Give the video a title', 'INVALID_DETAILS', 400);
  if (title.length > 255) throw new GetStreamError('The title is too long (255 characters max)', 'INVALID_DETAILS', 400);

  const description = body.description == null ? null : String(body.description).trim().slice(0, 5000) || null;

  const price = body.price === undefined || body.price === '' ? 0 : Number(body.price);
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
    throw new GetStreamError('Enter a valid price', 'INVALID_DETAILS', 400);
  }

  const currency = String(body.currency || 'NGN').toUpperCase();
  if (!['NGN', 'USD'].includes(currency)) throw new GetStreamError('Currency must be NGN or USD', 'INVALID_DETAILS', 400);

  const privacy = body.privacy || 'public';
  if (!['public', 'unlisted', 'private'].includes(privacy)) {
    throw new GetStreamError('Privacy must be public, unlisted or private', 'INVALID_DETAILS', 400);
  }

  const category = body.category ? String(body.category).trim().slice(0, 100) || null : null;
  const rawTags = Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? body.tags.split(',') : [];
  const tags = rawTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);

  return { title, description, price: Math.round(price * 100) / 100, currency, privacy, category, tags };
};

const publicationView = (publication, video) => ({
  videoId: publication.videoId,
  status: video ? video.status : 'failed',
  title: video ? video.title : null
});

/** Mark a published recording's video as ready, from a Mux asset. */
const markReady = async (videoId, asset) => {
  const video = await Video.findByPk(videoId);
  if (!video || video.status === 'ready') return video;
  const playbackId = asset.playback_ids?.[0]?.id || null;
  await video.update({
    status: 'ready',
    muxAssetId: asset.id,
    muxPlaybackId: playbackId,
    durationSeconds: Math.floor(asset.duration || 0),
    thumbnailUrl: video.thumbnailUrl || (playbackId ? muxThumbnail(playbackId) : null)
  });
  return video;
};

const markFailed = (videoId) =>
  Video.update({ status: 'failed' }, { where: { id: videoId, status: { [Op.ne]: 'ready' } } });

/**
 * Publish one recording as a video.
 * @param {{ sourceType: 'class'|'session', sourceId: string, recordings: Array, userId: number, body: object }} args
 * @returns {Promise<{ video: object, alreadyPublished: boolean }>}
 */
const publishRecording = async ({ sourceType, sourceId, recordings, userId, body }) => {
  const filename = String(body?.filename || '');
  const recording = recordings.find((r) => r.filename === filename);
  if (!filename || !recording) throw new GetStreamError('Recording not found', 'RECORDING_NOT_FOUND', 404);
  if (!recording.url) throw new GetStreamError('This recording is still being prepared. Try again in a few minutes.', 'RECORDING_NOT_READY', 409);

  const details = parseDetails(body);
  const where = { sourceType, sourceId: String(sourceId), filename };

  // Already published? Return it — unless that attempt failed, then start over.
  const existing = await RecordingPublication.findOne({ where });
  if (existing) {
    const video = await Video.findByPk(existing.videoId);
    if (video && video.status !== 'failed') return { video: video.toJSON(), alreadyPublished: true };
    await existing.destroy();
    if (video) await video.destroy();
  }

  const video = await Video.create({
    userId,
    ...details,
    type: 'long',
    ageRestriction: false,
    status: 'uploading'
  });

  try {
    await RecordingPublication.create({ ...where, videoId: video.id, userId });
  } catch (error) {
    await video.destroy();
    if (error instanceof UniqueConstraintError) {
      // A second tap got there first: return that one.
      const winner = await RecordingPublication.findOne({ where });
      const winnerVideo = winner && (await Video.findByPk(winner.videoId));
      if (winnerVideo) return { video: winnerVideo.toJSON(), alreadyPublished: true };
    }
    throw error;
  }

  try {
    const asset = await mux().video.assets.create({
      inputs: [{ url: recording.url }],
      playback_policies: ['public'],
      passthrough: `${PASSTHROUGH_PREFIX}${video.id}`
    });
    await video.update({ muxAssetId: asset.id });
  } catch (error) {
    await RecordingPublication.destroy({ where });
    await video.destroy();
    console.error('[Recording Publish] Mux import failed:', error.message);
    throw new GetStreamError("Couldn't start the import. Please try again.", 'PUBLISH_FAILED', 502);
  }

  console.log(`[Recording Publish] ${sourceType} ${sourceId} recording ${filename} -> video ${video.id}`);
  return { video: video.toJSON(), alreadyPublished: false };
};

/**
 * Adds `publication` ({ videoId, status, title } or null) to each recording.
 * Videos still importing are re-checked with Mux, in case a webhook was missed.
 * Never throws: on any failure the recordings come back unchanged.
 */
const withPublications = async (sourceType, sourceId, recordings) => {
  try {
    if (!recordings.length) return recordings;
    const publications = await RecordingPublication.findAll({ where: { sourceType, sourceId: String(sourceId) } });
    if (!publications.length) return recordings.map((r) => ({ ...r, publication: null }));

    const videos = await Video.findAll({ where: { id: publications.map((p) => p.videoId) } });
    const videoById = new Map(videos.map((v) => [v.id, v]));

    const pending = videos.filter((v) => v.status === 'uploading' && v.muxAssetId).slice(0, MAX_STATUS_CHECKS);
    await Promise.all(
      pending.map(async (video) => {
        try {
          const asset = await mux().video.assets.retrieve(video.muxAssetId);
          if (asset.status === 'ready') await markReady(video.id, asset);
          else if (asset.status === 'errored') await markFailed(video.id);
          await video.reload();
        } catch (error) {
          console.warn('[Recording Publish] Status check failed:', error.message);
        }
      })
    );

    const byFilename = new Map(publications.map((p) => [p.filename, publicationView(p, videoById.get(p.videoId))]));
    return recordings.map((r) => ({ ...r, publication: byFilename.get(r.filename) || null }));
  } catch (error) {
    console.warn('[Recording Publish] Could not attach publications:', error.message);
    return recordings;
  }
};

/**
 * Mux webhook events for published recordings. Returns false for everything
 * else (uploads, live streams), which the existing handler deals with.
 */
const handleMuxAssetEvent = async (type, data) => {
  if (!data || data.upload_id || data.live_stream_id) return false;
  if (typeof data.passthrough !== 'string' || !data.passthrough.startsWith(PASSTHROUGH_PREFIX)) return false;
  const videoId = data.passthrough.slice(PASSTHROUGH_PREFIX.length);
  if (!UUID_RE.test(videoId)) return false;

  if (type === 'video.asset.ready') {
    await markReady(videoId, data);
    console.log(`[Recording Publish] Video ${videoId} ready`);
    return true;
  }
  if (type === 'video.asset.errored') {
    await markFailed(videoId);
    console.log(`[Recording Publish] Video ${videoId} import failed`);
    return true;
  }
  return false;
};

module.exports = {
  publishRecording,
  withPublications,
  handleMuxAssetEvent,
  // Exported for tests.
  parseDetails,
  PASSTHROUGH_PREFIX
};
