/**
 * Growth insights for staff: active users and retention, the sign-up to
 * purchase funnel, and a creator leaderboard.
 *
 * Read-only aggregate queries, run only when someone opens the Insights page
 * (no background jobs). Days are UTC days, like activity tracking. Revenue
 * counts real money only: payments made with test keys are left out.
 */
const sequelize = require('../config/db');
const { withAvatar } = require('../utils/userAvatar');

const TZ = 'UTC'; // Hallos is used worldwide: one global day boundary
const select = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
const pick = (value, allowed, fallback) => (allowed.includes(Number(value)) ? Number(value) : fallback);
const realMoney = (alias) =>
  require('./gatewayModeService').isReady()
    ? `AND NOT EXISTS (SELECT 1 FROM test_payments t WHERE t.reference = ${alias}.payment_reference)`
    : '';
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// --- Engagement -----------------------------------------------------------------

async function engagement({ days = 30 } = {}) {
  const span = pick(days, [30, 90], 30);
  const [counts] = await select(
    `WITH today AS (SELECT (NOW() AT TIME ZONE '${TZ}')::date AS d)
     SELECT
       COUNT(DISTINCT user_id) FILTER (WHERE day = (SELECT d FROM today))                                         AS dau,
       COUNT(DISTINCT user_id) FILTER (WHERE day = (SELECT d FROM today) - 1)                                     AS dau_prev,
       COUNT(DISTINCT user_id) FILTER (WHERE day > (SELECT d FROM today) - 7)                                     AS wau,
       COUNT(DISTINCT user_id) FILTER (WHERE day <= (SELECT d FROM today) - 7 AND day > (SELECT d FROM today) - 14) AS wau_prev,
       COUNT(DISTINCT user_id) FILTER (WHERE day > (SELECT d FROM today) - 30)                                    AS mau,
       COUNT(DISTINCT user_id) FILTER (WHERE day <= (SELECT d FROM today) - 30 AND day > (SELECT d FROM today) - 60) AS mau_prev
     FROM user_daily_activity WHERE day > (SELECT d FROM today) - 60`
  );
  const series = await select(
    `WITH today AS (SELECT (NOW() AT TIME ZONE '${TZ}')::date AS d),
          days AS (SELECT generate_series((SELECT d FROM today) - (:span - 1), (SELECT d FROM today), '1 day')::date AS day)
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
            (SELECT COUNT(*) FROM user_daily_activity a WHERE a.day = days.day)::int AS active,
            (SELECT COUNT(*) FROM "Users" u WHERE ("createdAt" AT TIME ZONE '${TZ}')::date = days.day)::int AS signups
       FROM days ORDER BY days.day`,
    { span }
  );
  const [{ since }] = await select(`SELECT to_char(MIN(day), 'YYYY-MM-DD') AS since FROM user_daily_activity`);

  // Weekly sign-up cohorts (last 8 weeks): share active in each later week.
  const cohortRows = await select(
    `WITH today AS (SELECT (NOW() AT TIME ZONE '${TZ}')::date AS d),
          c AS (
            SELECT id, ("createdAt" AT TIME ZONE '${TZ}')::date AS signup,
                   date_trunc('week', ("createdAt" AT TIME ZONE '${TZ}')::date)::date AS cohort
              FROM "Users"
             WHERE ("createdAt" AT TIME ZONE '${TZ}')::date > (SELECT d FROM today) - 56)
     SELECT to_char(c.cohort, 'YYYY-MM-DD') AS cohort, COUNT(DISTINCT c.id)::int AS size,
            COUNT(DISTINCT c.id) FILTER (WHERE a.day - c.signup BETWEEN 7 AND 13)::int AS w1,
            COUNT(DISTINCT c.id) FILTER (WHERE a.day - c.signup BETWEEN 14 AND 20)::int AS w2,
            COUNT(DISTINCT c.id) FILTER (WHERE a.day - c.signup BETWEEN 21 AND 27)::int AS w3,
            COUNT(DISTINCT c.id) FILTER (WHERE a.day - c.signup BETWEEN 28 AND 34)::int AS w4,
            COUNT(DISTINCT c.id) FILTER (WHERE a.day - c.signup BETWEEN 1 AND 6)::int AS w0
       FROM c LEFT JOIN user_daily_activity a ON a.user_id = c.id AND a.day > c.signup
      GROUP BY c.cohort ORDER BY c.cohort DESC`
  );
  const [{ today }] = await select(`SELECT to_char((NOW() AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS today`);
  const daysSince = (date) => Math.floor((Date.parse(today) - Date.parse(date)) / 86400000);
  const cohorts = cohortRows.map((r) => {
    const age = daysSince(r.cohort); // days since the cohort's first day
    // A week only counts once every member could have reached it.
    const weekShare = (count, endDay) => (age >= endDay + 6 ? pct(count, r.size) : null);
    return {
      cohort: r.cohort,
      size: r.size,
      weeks: [weekShare(r.w0, 6), weekShare(r.w1, 13), weekShare(r.w2, 20), weekShare(r.w3, 27), weekShare(r.w4, 34)],
    };
  });

  const n = (v) => Number(v || 0);
  return {
    span,
    trackingSince: since,
    dau: { value: n(counts.dau), previous: n(counts.dau_prev) },
    wau: { value: n(counts.wau), previous: n(counts.wau_prev) },
    mau: { value: n(counts.mau), previous: n(counts.mau_prev) },
    stickiness: pct(n(counts.dau), n(counts.mau)),
    series,
    cohorts,
  };
}

// --- Funnel -----------------------------------------------------------------------

async function funnel({ days = 30 } = {}) {
  const span = pick(days, [30, 90, 365], 30);
  const [row] = await select(
    `WITH c AS (
       SELECT id, ("createdAt" AT TIME ZONE '${TZ}')::date AS signup, "createdAt" AS signed_up_at
         FROM "Users" WHERE "createdAt" >= NOW() - (:span || ' days')::interval),
     back AS (SELECT DISTINCT c.id FROM c JOIN user_daily_activity a ON a.user_id = c.id AND a.day > c.signup),
     buys AS (
       SELECT p.user_id, COUNT(*) AS n, MIN(p.created_at) AS first_at
         FROM purchases p JOIN c ON c.id = p.user_id
        WHERE p.payment_status::text IN ('completed', 'refunded') AND p.amount > 0 ${realMoney('p')}
        GROUP BY p.user_id)
     SELECT (SELECT COUNT(*) FROM c)::int AS signed_up,
            (SELECT COUNT(*) FROM back)::int AS came_back,
            (SELECT COUNT(*) FROM buys)::int AS bought,
            (SELECT COUNT(*) FROM buys WHERE n >= 2)::int AS bought_again,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (b.first_at - c.signed_up_at)) / 86400)
               FROM buys b JOIN c ON c.id = b.user_id) AS median_days`,
    { span }
  );
  const steps = [
    { key: 'signed_up', label: 'Signed up', count: row.signed_up },
    { key: 'came_back', label: 'Came back another day', count: row.came_back },
    { key: 'bought', label: 'Made a first purchase', count: row.bought },
    { key: 'bought_again', label: 'Bought again', count: row.bought_again },
  ].map((step, index, all) => ({
    ...step,
    ofStart: pct(step.count, all[0].count),
    ofPrevious: index === 0 ? null : pct(step.count, all[index - 1].count),
  }));
  return {
    span,
    steps,
    medianDaysToFirstPurchase: row.median_days === null ? null : Math.round(Number(row.median_days) * 10) / 10,
  };
}

// --- Creators -----------------------------------------------------------------------

async function creators({ days = 30, currency = 'NGN' } = {}) {
  const span = pick(days, [30, 90, 365], 30);
  const cur = ['NGN', 'USD'].includes(String(currency).toUpperCase()) ? String(currency).toUpperCase() : 'NGN';
  const rows = await select(
    `WITH sales AS (
       SELECT p.amount, p.user_id AS buyer, p.created_at,
              COALESCE(v.user_id, lc.user_id, ls.user_id, f.user_id) AS creator
         FROM purchases p
         LEFT JOIN videos v ON p.content_type::text = 'video' AND v.id = p.content_id
         LEFT JOIN live_classes lc ON p.content_type::text = 'live_class' AND lc.id = p.content_id
         LEFT JOIN live_series ls ON p.content_type::text = 'live_series' AND ls.id = p.content_id
         LEFT JOIN freebies f ON p.content_type::text = 'freebie' AND f.id = p.content_id
        WHERE p.payment_status::text = 'completed' AND p.currency = :cur AND p.amount > 0
          AND p.created_at >= NOW() - (:double || ' days')::interval ${realMoney('p')})
     SELECT creator,
            COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - (:span || ' days')::interval), 0) AS revenue,
            COUNT(*) FILTER (WHERE created_at >= NOW() - (:span || ' days')::interval)::int AS sales,
            COUNT(DISTINCT buyer) FILTER (WHERE created_at >= NOW() - (:span || ' days')::interval)::int AS buyers,
            COALESCE(SUM(amount) FILTER (WHERE created_at < NOW() - (:span || ' days')::interval), 0) AS previous
       FROM sales WHERE creator IS NOT NULL
      GROUP BY creator
     HAVING COUNT(*) FILTER (WHERE created_at >= NOW() - (:span || ' days')::interval) > 0
      ORDER BY revenue DESC, sales DESC
      LIMIT 25`,
    { cur, span, double: span * 2 }
  );
  const ids = rows.map((r) => Number(r.creator));
  const people = ids.length
    ? new Map((await select('SELECT id, firstname, lastname, email, social_links AS "socialLinks" FROM "Users" WHERE id IN (:ids)', { ids })).map((u) => [Number(u.id), withAvatar(u)]))
    : new Map();
  const [totals] = await select(
    `SELECT COALESCE(SUM(amount), 0) AS revenue, COUNT(*)::int AS sales FROM purchases p
      WHERE p.payment_status::text = 'completed' AND p.currency = :cur AND p.amount > 0
        AND p.created_at >= NOW() - (:span || ' days')::interval ${realMoney('p')}`,
    { cur, span }
  );
  return {
    span,
    currency: cur,
    total: { revenue: Number(totals.revenue), sales: totals.sales },
    creators: rows.map((r, index) => {
      const person = people.get(Number(r.creator));
      const revenue = Number(r.revenue);
      const previous = Number(r.previous);
      return {
        rank: index + 1,
        userId: Number(r.creator),
        name: person ? [person.firstname, person.lastname].filter(Boolean).join(' ') || null : null,
        email: person?.email ?? null,
        avatarUrl: person?.avatarUrl ?? null,
        revenue,
        sales: r.sales,
        buyers: r.buyers,
        share: pct(revenue, Number(totals.revenue)),
        growth: previous > 0 ? pct(revenue - previous, previous) : null,
        isNew: previous === 0,
      };
    }),
  };
}

module.exports = { engagement, funnel, creators };
