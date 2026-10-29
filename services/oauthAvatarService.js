/**
 * Copies a Google account photo into our own storage as the user's profile
 * picture — only when they don't have one yet (an uploaded picture is never
 * replaced).
 *
 * Why copy instead of linking Google's URL: our pages only render images from
 * hosts they trust (next.config), Google photo links can change, and this way
 * every avatar is served from the same place as other uploads.
 *
 * Runs in the background after sign-in; any failure just leaves the initial
 * fallback in place and never affects signing in.
 */

const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 6000;

const sniff = (buffer) => require('./liveChatMediaService').sniffImageType(buffer);

/** Google serves small photos by default ("=s96-c"); ask for a sharper one. */
const largerGooglePhoto = (url) => url.replace(/=s\d+(-c)?$/, '=s256-c');

const hasPicture = (user) => {
  const links = user.socialLinks || {};
  return typeof links.profilePicture === 'string' && links.profilePicture.trim() !== '';
};

/**
 * @param {number} userId
 * @param {string|undefined} photoUrl  from the Google profile
 */
const importGooglePhoto = async (userId, photoUrl) => {
  try {
    if (!photoUrl || !/^https:\/\//i.test(photoUrl)) return;
    const storage = require('./s3Service');
    if (!storage.isStorageConfigured()) return;

    const User = require('../models/User');
    const user = await User.findByPk(userId);
    if (!user || hasPicture(user)) return;

    const response = await fetch(largerGooglePhoto(photoUrl), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return;
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) return;
    const type = sniff(buffer);
    if (!type) return;

    const { url } = await storage.uploadFileToS3(buffer, `google${type.ext}`, type.mime, 'profiles');

    // Re-read so a picture uploaded in the meantime wins.
    await user.reload();
    if (hasPicture(user)) return;
    await user.update({ socialLinks: { ...(user.socialLinks || {}), profilePicture: url, profilePictureSource: 'google' } });
    console.log(`[OAuth Avatar] Saved Google photo for user ${userId}`);
  } catch (error) {
    console.warn(`[OAuth Avatar] Could not import Google photo for user ${userId}:`, error.message);
  }
};

module.exports = { importGooglePhoto, largerGooglePhoto };
