/**
 * Who a live-room gift goes to.
 *   - Attendees can only gift the host.
 *   - Hosts and co-hosts choose a recipient, who must belong to the class and
 *     isn't themselves.
 *
 * @param {{ hostUserId: number, roleOf: (userId: number) => Promise<string|null> }} target
 * @param {'host'|'cohost'|'attendee'} role  the sender's role
 * @param {number} senderId
 * @param {unknown} requested  recipientId from the request, if any
 * @returns {Promise<{ recipientId?: number, error?: string }>}
 */
const resolveRecipient = async (target, role, senderId, requested) => {
  const isStaff = role === 'host' || role === 'cohost';
  const requestedId = requested === undefined || requested === null || requested === '' ? null : Number(requested);
  if (requestedId !== null && !Number.isInteger(requestedId)) return { error: 'Choose who to send the gift to' };

  if (!isStaff) {
    if (requestedId !== null && requestedId !== target.hostUserId) return { error: 'You can send gifts to the host' };
    return { recipientId: target.hostUserId };
  }

  if (requestedId === null) return { error: 'Choose who to send the gift to' };
  if (requestedId === senderId) return { error: "You can't send a gift to yourself" };
  if (!(await target.roleOf(requestedId))) return { error: "That person isn't part of this class" };
  return { recipientId: requestedId };
};

module.exports = { resolveRecipient };
