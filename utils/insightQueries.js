const { col, fn, QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

const LIST_LIMIT = 20;

/** Runs one section of the user page; if it fails, only that section is empty. */
async function safe(label, load, fallback) {
  try {
    return await load();
  } catch (error) {
    console.warn(`[UserInsights] ${label} unavailable:`, error.message);
    return fallback;
  }
}

const select = (sql, replacements) =>
  sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

const plain = (rows) => rows.map((row) => row.get({ plain: true }));

const recent = async (Model, where, extra = {}) =>
  plain(await Model.findAll({ where, order: [['createdAt', 'DESC']], limit: LIST_LIMIT, ...extra }));

async function namesById(Model, ids, attribute = 'title') {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await Model.findAll({
    where: { id: unique },
    attributes: ['id', attribute],
    raw: true,
  });
  return new Map(rows.map((row) => [row.id, row[attribute]]));
}

/** `divisor` converts amounts stored in minor units (kobo, cents). */
async function totalsByCurrency(Model, where, sumColumn, divisor = 1) {
  const rows = await Model.findAll({
    where,
    attributes: ['currency', [fn('SUM', col(sumColumn)), 'total'], [fn('COUNT', col('id')), 'count']],
    group: ['currency'],
    raw: true,
  });
  return rows.map((row) => ({
    currency: row.currency,
    total: (Number(row.total) || 0) / divisor,
    count: Number(row.count) || 0,
  }));
}

module.exports = { LIST_LIMIT, safe, select, plain, recent, namesById, totalsByCurrency };
