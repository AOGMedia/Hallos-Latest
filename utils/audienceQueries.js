const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Who is in a live class or series. Free sign-ups are stored as attendee or
 * registration rows; paid ones only as completed purchases. Both count, and a
 * person who has both counts once (as paid).
 */
const SOURCES = {
  class: {
    table: 'live_attendees',
    key: 'live_class_id',
    contentType: 'live_class',
  },
  series: {
    table: 'live_series_registrations',
    key: 'series_id',
    contentType: 'live_series',
  },
};

const audienceSql = (kind) => {
  const { table, key, contentType } = SOURCES[kind];
  return `
    SELECT content_id, user_id, BOOL_OR(paid) AS paid, MIN(joined_at) AS joined_at
      FROM (
        SELECT ${key}::text AS content_id, user_id, FALSE AS paid, created_at AS joined_at
          FROM ${table} WHERE ${key}::text IN (:ids)
        UNION ALL
        SELECT content_id::text, user_id, TRUE, created_at
          FROM purchases
         WHERE content_type = '${contentType}' AND payment_status = 'completed' AND content_id::text IN (:ids)
      ) people
     GROUP BY content_id, user_id`;
};

/** content id -> number of distinct people. */
async function countAudience(kind, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await sequelize.query(
    `SELECT content_id, COUNT(*)::int AS count FROM (${audienceSql(kind)}) grouped GROUP BY content_id`,
    { replacements: { ids: unique }, type: QueryTypes.SELECT }
  );
  return new Map(rows.map((row) => [row.content_id, row.count]));
}

/** Everyone in one class or series, newest first. */
async function listAudience(kind, id, limit = 200) {
  const rows = await sequelize.query(
    `${audienceSql(kind)} ORDER BY joined_at DESC LIMIT ${Number(limit)}`,
    { replacements: { ids: [String(id)] }, type: QueryTypes.SELECT }
  );
  return rows.map((row) => ({ userId: row.user_id, paid: Boolean(row.paid), joinedAt: row.joined_at }));
}

/** Everything one person joined, of one kind: [{ contentId, paid, joinedAt }], newest first. */
async function listForUser(kind, userId, limit = 20) {
  const { table, key, contentType } = SOURCES[kind];
  const rows = await sequelize.query(
    `SELECT content_id, BOOL_OR(paid) AS paid, MIN(joined_at) AS joined_at
       FROM (
         SELECT ${key}::text AS content_id, FALSE AS paid, created_at AS joined_at
           FROM ${table} WHERE user_id = :userId
         UNION ALL
         SELECT content_id::text, TRUE, created_at
           FROM purchases
          WHERE content_type = '${contentType}' AND payment_status = 'completed' AND user_id = :userId
       ) joined
      GROUP BY content_id
      ORDER BY MIN(joined_at) DESC`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return {
    total: rows.length,
    items: rows.slice(0, limit).map((row) => ({ contentId: row.content_id, paid: Boolean(row.paid), joinedAt: row.joined_at })),
  };
}

module.exports = { countAudience, listAudience, listForUser };
