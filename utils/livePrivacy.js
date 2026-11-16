/**
 * What the public live series and session endpoints may show.
 *
 * - A creator's email address is personal: only the creator themselves and
 *   super admins see it.
 * - A session's room ids and recording link are what you pay for: only people
 *   with access (free series, the creator, buyers) and super admins see them.
 *   Joining still goes through the join endpoints, which check access again.
 * - Internal bookkeeping (the idempotency key) is never public.
 */
const SESSION_PRIVATE_FIELDS = ['zegoRoomId', 'zegoAppId', 'recordingUrl', 'zego_room_id', 'zego_app_id', 'recording_url'];

const isSuperAdmin = (user) => user?.role === 'admin';

const plain = (value) => (value && typeof value.toJSON === 'function' ? value.toJSON() : value ? { ...value } : value);

/** The creator object for a viewer: without the email unless it's them or a super admin. */
function creatorFor(creator, viewer) {
  if (!creator) return creator;
  if (isSuperAdmin(viewer) || (viewer && Number(viewer.id) === Number(creator.id))) return creator;
  const { email, ...rest } = creator;
  return rest;
}

/** A session for a viewer: room ids and recording only with access (or for a super admin). */
function sessionFor(session, { canSee }) {
  const data = plain(session);
  if (!data || canSee) return data;
  for (const field of SESSION_PRIVATE_FIELDS) delete data[field];
  return data;
}

/** Series fields for a viewer: internal bookkeeping only for its creator or a super admin. */
function seriesFieldsFor(fields, viewer) {
  if (!fields) return fields;
  if (isSuperAdmin(viewer) || (viewer && Number(viewer.id) === Number(fields.userId))) return fields;
  const { idempotencyKey, idempotency_key, ...rest } = fields;
  return rest;
}

module.exports = { isSuperAdmin, creatorFor, sessionFor, seriesFieldsFor };
