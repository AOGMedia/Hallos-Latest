const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');
const { isAdminFoundationsReady } = require('../utils/ensureAdminFoundations');

/**
 * Reads the staff action log, newest first, with simple filters. Paged with a
 * keyset cursor (the last id seen) so deep pages stay fast on a large table.
 */
const MAX_LIMIT = 100;

async function listActivity({ actorId, search, from, to, before, limit = 50 } = {}) {
  if (!isAdminFoundationsReady()) return { items: [], nextCursor: null, available: false };
  const size = Math.min(Math.max(parseInt(limit, 10) || 50, 1), MAX_LIMIT);
  const clauses = ['TRUE'];
  const replacements = { limit: size + 1 };

  if (Number.isInteger(Number(actorId)) && actorId) {
    clauses.push('a.actor_id = :actorId');
    replacements.actorId = Number(actorId);
  }
  const term = String(search || '').trim().slice(0, 100);
  if (term) {
    clauses.push('a.path ILIKE :search');
    replacements.search = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
  }
  if (from && !Number.isNaN(Date.parse(from))) {
    clauses.push('a.created_at >= :from');
    replacements.from = new Date(from);
  }
  if (to && !Number.isNaN(Date.parse(to))) {
    clauses.push('a.created_at < :to');
    replacements.to = new Date(to);
  }
  if (/^\d+$/.test(String(before || ''))) {
    clauses.push('a.id < :before');
    replacements.before = before;
  }

  const rows = await sequelize.query(
    `SELECT a.id, a.actor_id AS "actorId", a.actor_role AS "actorRole", a.method, a.path, a.status,
            a.details, a.ip, a.created_at AS "createdAt",
            u.firstname AS "actorFirstname", u.lastname AS "actorLastname", u.email AS "actorEmail"
       FROM admin_action_log a
       LEFT JOIN "Users" u ON u.id = a.actor_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY a.id DESC
      LIMIT :limit`,
    { replacements, type: QueryTypes.SELECT }
  );
  const hasMore = rows.length > size;
  const items = hasMore ? rows.slice(0, size) : rows;
  return { items, nextCursor: hasMore ? String(items[items.length - 1].id) : null, available: true };
}

module.exports = { listActivity };
