const { Op, QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * One search box across the admin: people, payments, payouts, content, live
 * classes and series, communities and coupons, in one request.
 *
 * Each group is searched only when the staff member may see it (super admins
 * see everything), each is capped at PER_GROUP results, and each has its own
 * time limit, so one slow table never holds up the rest (it's left out instead).
 * Read-only; nothing runs in the background.
 */
const PER_GROUP = 5;
const GROUP_TIMEOUT_MS = 3000;

const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const withTimeout = (promise) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), GROUP_TIMEOUT_MS))]);
const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

const money = (amount, currency) => {
  const value = Number(amount || 0);
  return currency === 'USD' ? `$${value.toFixed(2)}` : `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
};

/** Each group: who may see it and how to search it. `like` is "%term%", `prefix` is "term%". */
const GROUPS = [
  {
    key: 'users',
    label: 'People',
    permission: 'users.view',
    run: async ({ like, term, prefix }) => {
      const id = /^\d{1,9}$/.test(term) ? Number(term) : null;
      const rows = await select(
        `SELECT id, firstname, lastname, email, role
           FROM "Users"
          WHERE email NOT LIKE '%@deleted.hallos.invalid'
            AND (${id ? 'id = :id OR ' : ''}email ILIKE :like OR CONCAT(firstname, ' ', lastname) ILIKE :like OR phone_number ILIKE :like)
          -- Best first: the exact id or email, then names that start with the term, then newest.
          ORDER BY (${id ? 'id = :id OR ' : ''}LOWER(email) = LOWER(:term)) DESC,
                   (firstname ILIKE :prefix OR lastname ILIKE :prefix OR email ILIKE :prefix) DESC,
                   id DESC
          LIMIT ${PER_GROUP + 1}`,
        { like, term, id, prefix }
      );
      return rows.map((u) => ({
        type: 'user',
        id: String(u.id),
        title: [u.firstname, u.lastname].filter(Boolean).join(' ') || u.email,
        subtitle: `${u.email} · ${u.role || 'viewer'}`,
      }));
    },
  },
  {
    key: 'payments',
    label: 'Payments',
    permission: 'payments.view',
    run: async ({ term, like, prefix }) => {
      const Purchase = require('../models/Purchase');
      // References are often pasted in part: match anywhere once it's long enough to be specific.
      const rows = await Purchase.findAll({
        where: { paymentReference: { [Op.iLike]: term.length >= 6 ? like : prefix } },
        attributes: ['id', 'paymentReference', 'amount', 'currency', 'paymentStatus', 'contentType', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: PER_GROUP + 1,
        raw: true,
      });
      return rows.map((p) => ({
        type: 'payment',
        id: String(p.id),
        title: p.paymentReference,
        subtitle: `${money(p.amount, p.currency)} · ${p.contentType || 'purchase'} · ${p.paymentStatus || ''}`.replace(/ · $/, ''),
        query: p.paymentReference,
      }));
    },
  },
  {
    key: 'payouts',
    label: 'Payouts',
    permission: 'payouts.view',
    run: async ({ like, prefix }) => {
      const Payout = require('../models/Payout');
      const rows = await Payout.findAll({
        where: { [Op.or]: [{ transferReference: { [Op.iLike]: prefix } }, { accountName: { [Op.iLike]: like } }] },
        attributes: ['id', 'transferReference', 'accountName', 'amount', 'currency', 'status', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: PER_GROUP + 1,
        raw: true,
      });
      return rows.map((p) => ({
        type: 'payout',
        id: String(p.id),
        title: p.accountName || p.transferReference || 'Payout',
        subtitle: `${money(p.amount, p.currency)} · ${p.status}${p.transferReference ? ` · ${p.transferReference}` : ''}`,
        query: p.accountName || p.transferReference,
      }));
    },
  },
  {
    key: 'content',
    label: 'Content',
    permission: 'content.view',
    run: async ({ like }) => {
      const Video = require('../models/Video');
      const Freebie = require('../models/Freebie');
      const Course = require('../models/Course');
      const [videos, freebies, courses] = await Promise.all([
        Video.findAll({ where: { title: { [Op.iLike]: like } }, attributes: ['id', 'title'], order: [['createdAt', 'DESC']], limit: PER_GROUP + 1, raw: true }),
        Freebie.findAll({ where: { title: { [Op.iLike]: like } }, attributes: ['id', 'title'], order: [['createdAt', 'DESC']], limit: PER_GROUP + 1, raw: true }),
        Course.findAll({ where: { name: { [Op.iLike]: like } }, attributes: ['id', 'name'], limit: PER_GROUP + 1, raw: true }),
      ]);
      return [
        ...videos.map((v) => ({ type: 'video', id: String(v.id), title: v.title, subtitle: 'Video', query: v.title })),
        ...freebies.map((f) => ({ type: 'freebie', id: String(f.id), title: f.title, subtitle: 'Freebie', query: f.title })),
        ...courses.map((c) => ({ type: 'course', id: String(c.id), title: c.name, subtitle: 'Course', query: c.name })),
      ].slice(0, PER_GROUP + 1);
    },
  },
  {
    key: 'live',
    label: 'Live',
    permission: 'live.view',
    run: async ({ like }) => {
      const LiveClass = require('../models/liveClass');
      const LiveSeries = require('../models/LiveSeries');
      const [classes, series] = await Promise.all([
        LiveClass.findAll({ where: { title: { [Op.iLike]: like } }, attributes: ['id', 'title', 'status'], order: [['createdAt', 'DESC']], limit: PER_GROUP + 1, raw: true }),
        LiveSeries.findAll({ where: { title: { [Op.iLike]: like } }, attributes: ['id', 'title', 'status'], order: [['createdAt', 'DESC']], limit: PER_GROUP + 1, raw: true }),
      ]);
      return [
        ...classes.map((c) => ({ type: 'live-class', id: String(c.id), title: c.title, subtitle: `Live class · ${c.status}` })),
        ...series.map((s) => ({ type: 'live-series', id: String(s.id), title: s.title, subtitle: `Series · ${s.status}` })),
      ].slice(0, PER_GROUP + 1);
    },
  },
  {
    key: 'communities',
    label: 'Communities',
    permission: 'communities.view',
    run: async ({ like }) => {
      // Live member count (the stored member_count column is no longer kept up to date;
      // communityService counts active members the same way).
      const rows = await select(
        `SELECT c.id, c.name, c.status,
                (SELECT COUNT(*)::int FROM community_members m WHERE m.community_id = c.id AND m.status = 'active') AS members
           FROM communities c
          WHERE c.name ILIKE :like
          ORDER BY c.created_at DESC
          LIMIT ${PER_GROUP + 1}`,
        { like }
      );
      return rows.map((c) => ({ type: 'community', id: String(c.id), title: c.name, subtitle: `${c.members} member${c.members === 1 ? '' : 's'} · ${c.status}`, query: c.name }));
    },
  },
  {
    key: 'coupons',
    label: 'Coupons',
    permission: 'coupons.view',
    run: async ({ prefix }) => {
      const Coupon = require('../models/Coupon');
      const rows = await Coupon.findAll({ where: { code: { [Op.iLike]: prefix } }, attributes: ['id', 'code', 'status', 'usageCount'], order: [['createdAt', 'DESC']], limit: PER_GROUP + 1, raw: true });
      return rows.map((c) => ({ type: 'coupon', id: String(c.id), title: c.code, subtitle: `Coupon · ${c.status} · used ${c.usageCount ?? 0}×`, query: c.code }));
    },
  },
];

/**
 * @param {string} q the search term (2-100 characters)
 * @param {{ isSuperAdmin: boolean, permissions: string[] }} access
 */
async function search(q, access) {
  const term = String(q || '').trim().slice(0, 100);
  // Two characters at least, except numbers (short ids).
  if (term.length < 2 && !/^\d+$/.test(term)) return { query: term, groups: [] };
  const like = `%${escapeLike(term)}%`;
  const prefix = `${escapeLike(term)}%`;
  const allowed = GROUPS.filter((g) => access.isSuperAdmin || access.permissions.includes(g.permission));

  const settled = await Promise.allSettled(allowed.map((g) => withTimeout(g.run({ term, like, prefix }))));
  const groups = [];
  settled.forEach((result, i) => {
    const group = allowed[i];
    if (result.status === 'fulfilled') {
      // One extra row is fetched to know whether there are more than we show.
      if (result.value.length) {
        groups.push({ key: group.key, label: group.label, items: result.value.slice(0, PER_GROUP), more: result.value.length > PER_GROUP });
      }
    } else {
      console.warn(`[Admin search] ${group.key} skipped:`, result.reason?.message);
    }
  });
  return { query: term, groups };
}

module.exports = { search };
