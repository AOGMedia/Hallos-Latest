/**
 * A user's profile picture.
 *
 * Stored in users.social_links.profilePicture (where the profile page has
 * always saved it), so no schema change is needed. Everything that shows a
 * person reads it through avatarUrlOf, and API responses expose it as
 * `avatarUrl`. Missing => null (the frontend shows the person's initial).
 */

/** Profile picture URL for a User instance or plain object, or null. */
const avatarUrlOf = (user) => {
  if (!user) return null;
  const links = (user.get ? user.get('socialLinks') : user.socialLinks) || {};
  const url = typeof links === 'object' ? links.profilePicture : null;
  if (typeof url !== 'string' || !url.trim()) return null;
  // Absolute https URLs (object storage) or paths from local uploads.
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : null;
};

/**
 * Adds `avatarUrl` to an included user (e.g. `creator`) in a response object
 * and removes the raw socialLinks we only loaded to compute it.
 */
const withAvatar = (userJson) => {
  if (!userJson || typeof userJson !== 'object') return userJson;
  const { socialLinks, ...rest } = userJson;
  return { ...rest, avatarUrl: avatarUrlOf({ socialLinks }) };
};

module.exports = { avatarUrlOf, withAvatar };
