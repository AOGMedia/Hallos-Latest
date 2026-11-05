/**
 * A creator's finished GetStream classes that actually have recordings — the
 * "Past classes" list on the schedule page.
 *
 * Recordings live on GetStream, not in our database, so each class is checked
 * there. Results are remembered for a while (per class and call, so a class
 * that runs again is checked afresh): found recordings for hours, "none" for a
 * few minutes because GetStream takes a few minutes to finish a recording.
 */

const { LiveClass } = require('../models/liveIndex');
const { getStreamService } = require('./getStreamService');

const MAX_CLASSES = 100;
const CONCURRENCY = 4;
const FOUND_TTL_MS = 6 * 60 * 60 * 1000;
const NONE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 5000;

const cache = new Map(); // `${classId}:${callId}` -> { has, at }

const remember = (key, has) => {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, { has, at: Date.now() });
};

/** true / false, or null when GetStream couldn't be asked (not remembered). */
const hasRecordings = async (liveClass) => {
  const key = `${liveClass.id}:${liveClass.getstream_call_id || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.has ? FOUND_TTL_MS : NONE_TTL_MS)) return hit.has;
  try {
    const has = await getStreamService.classHasRecordings(liveClass);
    remember(key, has);
    return has;
  } catch (error) {
    console.warn(`[Recorded Classes] Could not check class ${liveClass.id}:`, error.message);
    return null;
  }
};

/** Run `fn` over items, at most `limit` at a time, keeping order. */
const mapLimit = async (items, limit, fn) => {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/**
 * The creator's ended GetStream classes with at least one recording, newest
 * first. A class GetStream couldn't be asked about is kept, so a hiccup never
 * hides someone's recordings.
 */
const listRecordedClasses = async (userId) => {
  const classes = await LiveClass.findAll({
    where: { userId, status: 'ended', streaming_provider: 'getstream' },
    attributes: ['id', 'title', 'startTime', 'updatedAt', 'getstream_call_id'],
    order: [['updatedAt', 'DESC']],
    limit: MAX_CLASSES
  });
  const flags = await mapLimit(classes, CONCURRENCY, hasRecordings);
  return classes
    .filter((_, i) => flags[i] !== false)
    .map((c) => ({ id: c.id, title: c.title, startTime: c.startTime, updatedAt: c.updatedAt }));
};

module.exports = { listRecordedClasses, mapLimit, _cache: cache };
