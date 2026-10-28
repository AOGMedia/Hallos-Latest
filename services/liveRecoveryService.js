/**
 * Live class recovery (ZegoCloud).
 *
 * Problem this solves: a class could be marked 'ended' in the database while
 * its ZegoCloud room was still running (the room is never force-closed —
 * zegoCloudService.deleteRoom is a no-op). People already inside kept
 * watching, but anyone loading the class page saw "ended" and joinRoom
 * refused them.
 *
 * Fix: while the host is in the room, their browser sends a heartbeat every
 * ~20s. The heartbeat
 *   - keeps a live class fresh (bumps updated_at, so the stale-class cron in
 *     liveClassCleanupService never ends a class someone is still hosting), and
 *   - reopens a class that was marked ended within RECOVERY_WINDOW_MS, but only
 *     when the host reports being in that exact room.
 *
 * A deliberate "End class for everyone" stops the heartbeat before ending,
 * so a real end is never undone. No schema changes: uses existing columns.
 */

const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

/**
 * Pure decision: what should a host heartbeat do to this class?
 * @param {{ status: string, endTime: Date|string|null, zego_room_id: string|null }} liveClass
 * @param {string|undefined} reportedRoomId room the host's client says it is in
 * @param {number} now epoch ms
 * @returns {'touch' | 'reopen' | 'none'}
 */
function decideHeartbeatAction(liveClass, reportedRoomId, now = Date.now()) {
  if (liveClass.status === 'live') return 'touch';

  if (liveClass.status !== 'ended') return 'none';
  if (!reportedRoomId || !liveClass.zego_room_id || reportedRoomId !== liveClass.zego_room_id) return 'none';
  if (!liveClass.endTime) return 'none';

  const endedAgo = now - new Date(liveClass.endTime).getTime();
  return endedAgo >= 0 && endedAgo <= RECOVERY_WINDOW_MS ? 'reopen' : 'none';
}

/**
 * Apply a host heartbeat to a LiveClass model instance.
 * @returns {Promise<{ status: string, recovered: boolean }>}
 */
async function applyHostHeartbeat(liveClass, reportedRoomId, now = Date.now()) {
  const action = decideHeartbeatAction(liveClass, reportedRoomId, now);

  if (action === 'touch') {
    // Bump updated_at only; nothing else about the class changes.
    liveClass.changed('updatedAt', true);
    await liveClass.save({ fields: ['updatedAt'] });
    return { status: 'live', recovered: false };
  }

  if (action === 'reopen') {
    const wrongfullyEndedAt = new Date(liveClass.endTime).toISOString();
    await liveClass.update({ status: 'live', endTime: null });
    console.warn(
      `[LiveRecovery] Reopened live class ${liveClass.id}: it was marked ended at ${wrongfullyEndedAt} ` +
        `but the host is still in room ${reportedRoomId}`
    );
    return { status: 'live', recovered: true };
  }

  return { status: liveClass.status, recovered: false };
}

module.exports = {
  RECOVERY_WINDOW_MS,
  decideHeartbeatAction,
  applyHostHeartbeat,
};
