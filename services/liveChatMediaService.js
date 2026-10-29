/**
 * Photos shared in GetStream live class chat.
 *
 * Stored in object storage (R2/S3) under one folder per class or series
 * session — live-chat/class-<id>/ or live-chat/session-<id>/ — so they can be
 * removed together when it ends. They're deleted:
 *   - right after the host ends the class/session, and
 *   - by a periodic sweep, for anything that ended another way (e.g. the
 *     stale-class cleanup) — any folder whose class/session isn't live.
 *
 * Uses the storage client from s3Service without changing it.
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ROOT = 'live-chat/';
const SWEEP_EVERY_MS = 30 * 60 * 1000;

/** Detects the real image type from the file's first bytes (never trusts the client's MIME type). */
const sniffImageType = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: '.png' };
  }
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: '.webp' };
  }
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') {
    return { mime: 'image/gif', ext: '.gif' };
  }
  return null;
};

const folderFor = ({ kind, id }) => `${ROOT}${kind === 'session' ? 'session' : 'class'}-${id}/`;

const storage = () => require('./s3Service');

const isAvailable = () => {
  try {
    return storage().isStorageConfigured();
  } catch {
    return false;
  }
};

/**
 * Store a chat photo. Returns its public URL.
 * @param {{ kind: 'class'|'session', id: string }} target
 * @param {Buffer} buffer
 */
const uploadChatPhoto = async (target, buffer) => {
  const type = sniffImageType(buffer);
  if (!type) {
    const error = new Error('Only JPEG, PNG, WebP or GIF photos can be shared');
    error.status = 400;
    throw error;
  }
  const { s3, bucket, buildPublicUrl } = storage();
  const key = `${folderFor(target)}${Date.now()}-${Math.random().toString(36).slice(2, 10)}${type.ext}`;
  const result = await s3
    .upload({ Bucket: bucket, Key: key, Body: buffer, ContentType: type.mime, ContentDisposition: 'inline' })
    .promise();
  return buildPublicUrl(result.Key || key, result.Location);
};

/** Delete every object under a prefix (paged, 1000 at a time). */
const deletePrefix = async (prefix) => {
  const { s3, bucket } = storage();
  let deleted = 0;
  let token;
  do {
    const page = await s3.listObjectsV2({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }).promise();
    const keys = (page.Contents || []).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      await s3.deleteObjects({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }).promise();
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
};

/** Remove all of a class's/session's chat photos. Best-effort: never throws. */
const deleteChatMedia = async (target) => {
  if (!isAvailable()) return 0;
  try {
    const deleted = await deletePrefix(folderFor(target));
    if (deleted) console.log(`[LiveChatMedia] Deleted ${deleted} chat photo(s) for ${target.kind} ${target.id}`);
    return deleted;
  } catch (error) {
    console.error(`[LiveChatMedia] Could not delete chat photos for ${target.kind} ${target.id}:`, error.message);
    return 0;
  }
};

/** Whether the class/session behind a folder is still live (unknown => not live). */
const isStillLive = async (kind, id) => {
  if (kind === 'session') {
    const { LiveSession } = require('../models/liveSeriesIndex');
    const session = await LiveSession.findByPk(id, { attributes: ['id', 'status'] });
    return Boolean(session && session.status === 'live');
  }
  const { LiveClass } = require('../models/liveIndex');
  const liveClass = await LiveClass.findByPk(id, { attributes: ['id', 'status'] });
  return Boolean(liveClass && liveClass.status === 'live');
};

/** Delete chat photos of every class/session that is no longer live. */
const sweepEndedChatMedia = async () => {
  if (!isAvailable()) return;
  try {
    const { s3, bucket } = storage();
    let token;
    do {
      const page = await s3
        .listObjectsV2({ Bucket: bucket, Prefix: ROOT, Delimiter: '/', ContinuationToken: token })
        .promise();
      for (const { Prefix } of page.CommonPrefixes || []) {
        const match = /^live-chat\/(class|session)-([0-9a-f-]{36})\/$/i.exec(Prefix || '');
        if (!match) continue;
        const [, kind, id] = match;
        if (!(await isStillLive(kind, id))) await deleteChatMedia({ kind, id });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } catch (error) {
    console.error('[LiveChatMedia] Sweep failed:', error.message);
  }
};

let sweeper = null;
/** Starts the periodic sweep (once). Safe to call when storage isn't configured. */
const startChatMediaSweeper = () => {
  if (sweeper || !isAvailable()) return;
  sweeper = setInterval(sweepEndedChatMedia, SWEEP_EVERY_MS);
  if (sweeper.unref) sweeper.unref();
};

module.exports = {
  MAX_PHOTO_BYTES,
  isAvailable,
  uploadChatPhoto,
  deleteChatMedia,
  sweepEndedChatMedia,
  startChatMediaSweeper,
  // Exported for tests.
  sniffImageType,
  folderFor
};
