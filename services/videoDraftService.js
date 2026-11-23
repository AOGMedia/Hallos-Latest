const sequelize = require('../config/db');
const { isVideoDraftsReady } = require('../utils/ensureVideoDrafts');

/**
 * Uploading a video the YouTube way: the file starts uploading (straight to
 * Mux, in resumable chunks from the browser) as soon as it's picked, while
 * the creator fills in the details. Until they press Publish the video is a
 * draft: a normal `videos` row kept private (so feeds, the video page and
 * search never show it) plus a marker in `video_drafts`.
 *
 * Publishing saves the details and makes it public at once; the feed only
 * lists ready videos, so it appears when Mux has finished processing. The
 * classic POST /videos/upload flow is untouched.
 */

class DraftError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'DraftError';
    this.status = status;
    this.code = code;
  }
}

const MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
/** The upload link stays valid long enough for big files on slow connections. */
const UPLOAD_TIMEOUT_SECONDS = 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVACY = ['public', 'unlisted', 'private'];
const CURRENCIES = ['NGN', 'USD'];
const TYPES = ['short', 'long'];

const mux = () => require('../config/mux');
const Video = () => require('../models/Video');

const requireReady = () => {
  if (!isVideoDraftsReady()) throw new DraftError('Uploads are being set up. Please try again shortly.', 503, 'DRAFTS_UNAVAILABLE');
};

/**
 * Only our own sites may send the file to the upload link. The browser's
 * Origin is used when it's one of ours (so local development works too).
 */
function uploadOrigin(requestOrigin) {
  const client = String(process.env.CLIENT_URL || 'https://hallos.net').replace(/\/+$/, '');
  const origin = String(requestOrigin || '').replace(/\/+$/, '');
  const ours =
    origin === client ||
    /^https:\/\/(www\.)?hallos\.net$/.test(origin) ||
    (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin));
  return ours ? origin : client;
}

/** "My Holiday Clip.mp4" -> "My Holiday Clip". */
function titleFromFileName(fileName) {
  const base = String(fileName || '')
    .replace(/\.[^./\\]{1,5}$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return base || 'Untitled video';
}

async function createMuxUpload(origin) {
  return mux().video.uploads.create({
    cors_origin: uploadOrigin(origin),
    timeout: UPLOAD_TIMEOUT_SECONDS,
    // Same playback setting as the classic upload flow.
    new_asset_settings: { playback_policy: ['public'] },
  });
}

const cancelMuxUpload = async (uploadId) => {
  if (!uploadId) return;
  try {
    await mux().video.uploads.cancel(uploadId);
  } catch {
    // Already finished, cancelled or timed out: nothing to stop.
  }
};

async function isDraft(videoId) {
  const [rows] = await sequelize.query('SELECT 1 FROM video_drafts WHERE video_id = :videoId', {
    replacements: { videoId },
  });
  return rows.length > 0;
}

/** The creator's own draft, or a DraftError. */
async function ownDraft(userId, videoId) {
  if (!UUID.test(String(videoId))) throw new DraftError('We couldn’t find this upload.', 404, 'NOT_FOUND');
  const video = await Video().findByPk(videoId);
  if (!video || Number(video.userId) !== Number(userId)) throw new DraftError('We couldn’t find this upload.', 404, 'NOT_FOUND');
  if (!(await isDraft(video.id))) throw new DraftError('This video has already been published.', 409, 'NOT_A_DRAFT');
  return video;
}

/** File picked: make the draft and its upload link. */
async function createDraft({ userId, fileName, sizeBytes, type, durationSeconds, origin }) {
  requireReady();
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) throw new DraftError('This file looks empty. Please choose another video.', 400, 'EMPTY_FILE');
  if (size > MAX_BYTES) throw new DraftError('This video is larger than 5 GB. Please choose a smaller file.', 413, 'TOO_LARGE');

  const upload = await createMuxUpload(origin);
  let video;
  try {
    const duration = Number(durationSeconds);
    video = await Video().create({
      userId,
      title: titleFromFileName(fileName),
      type: TYPES.includes(type) ? type : 'long',
      privacy: 'private', // hidden everywhere until Publish
      price: 0,
      currency: 'NGN',
      tags: [],
      muxUploadId: upload.id,
      status: 'uploading',
      sizeBytes: Math.round(size),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    });
    await sequelize.query(
      'INSERT INTO video_drafts (video_id, user_id, file_name) VALUES (:videoId, :userId, :fileName)',
      { replacements: { videoId: video.id, userId, fileName: String(fileName || '').slice(0, 255) || null } }
    );
  } catch (error) {
    // Never leave half a draft behind.
    if (video) await video.destroy().catch(() => {});
    await cancelMuxUpload(upload.id);
    throw error;
  }

  return {
    videoId: video.id,
    title: video.title,
    uploadUrl: upload.url,
    expiresAt: new Date(Date.now() + UPLOAD_TIMEOUT_SECONDS * 1000).toISOString(),
  };
}

/**
 * A fresh upload link for a draft whose upload didn't finish (tab closed,
 * link expired, upload failed). Picking the file again continues from here.
 */
async function restartUpload({ userId, videoId, origin }) {
  requireReady();
  const video = await ownDraft(userId, videoId);
  if (!['uploading', 'failed'].includes(video.status)) {
    throw new DraftError('This video has already been uploaded.', 409, 'ALREADY_UPLOADED');
  }
  const previous = video.muxUploadId;
  const upload = await createMuxUpload(origin);
  await video.update({ muxUploadId: upload.id, status: 'uploading' });
  await cancelMuxUpload(previous);
  return {
    videoId: video.id,
    title: video.title,
    uploadUrl: upload.url,
    expiresAt: new Date(Date.now() + UPLOAD_TIMEOUT_SECONDS * 1000).toISOString(),
  };
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Publish: save the details. It shows to people once Mux has processed it. */
async function publish({ userId, videoId, body = {}, thumbnailFile }) {
  requireReady();
  const video = await ownDraft(userId, videoId);

  const title = text(body.title, 255);
  if (!title) throw new DraftError('Please give your video a title.', 400, 'TITLE_REQUIRED');

  const price = body.price === undefined || body.price === '' || body.price === null ? 0 : Number(body.price);
  if (!Number.isFinite(price) || price < 0) throw new DraftError('Please enter a valid price.', 400, 'INVALID_PRICE');
  const currency = String(body.currency || 'NGN').toUpperCase();
  const tags = Array.isArray(body.tags)
    ? body.tags
    : typeof body.tags === 'string' && body.tags
      ? body.tags.split(',')
      : [];

  const changes = {
    title,
    description: text(body.description, 5000) || null,
    price,
    currency: CURRENCIES.includes(currency) ? currency : 'NGN',
    type: TYPES.includes(body.type) ? body.type : video.type,
    category: text(body.category, 100) || null,
    tags: tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30),
    privacy: PRIVACY.includes(body.privacy) ? body.privacy : 'public',
    ageRestriction: body.restriction === 'true' || body.restriction === true || body.ageRestriction === 'true',
  };
  if (thumbnailFile) changes.thumbnailUrl = thumbnailFile.location || `/upload/${thumbnailFile.filename}`;

  await sequelize.transaction(async (transaction) => {
    await video.update(changes, { transaction });
    await sequelize.query('DELETE FROM video_drafts WHERE video_id = :videoId', {
      replacements: { videoId: video.id },
      transaction,
    });
  });
  return video;
}

/** Discard a draft: stop its upload on Mux and remove it. */
async function discard({ userId, videoId }) {
  requireReady();
  const video = await ownDraft(userId, videoId);
  await cancelMuxUpload(video.muxUploadId);
  if (video.muxAssetId) {
    await mux().video.assets.delete(video.muxAssetId).catch(() => {});
  }
  await video.destroy();
  await sequelize.query('DELETE FROM video_drafts WHERE video_id = :videoId', { replacements: { videoId: video.id } });
  return { discarded: true };
}

/** Which of these videos are still drafts (for the creator's own list). */
async function draftIdsOf(userId) {
  if (!isVideoDraftsReady()) return new Set();
  const [rows] = await sequelize.query('SELECT video_id FROM video_drafts WHERE user_id = :userId', {
    replacements: { userId },
  });
  return new Set(rows.map((r) => String(r.video_id)));
}

module.exports = {
  DraftError,
  MAX_BYTES,
  UPLOAD_TIMEOUT_SECONDS,
  uploadOrigin,
  titleFromFileName,
  createDraft,
  restartUpload,
  publish,
  discard,
  draftIdsOf,
};
