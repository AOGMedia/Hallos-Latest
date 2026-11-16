const { Op, QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * The featured event (the /events page): what staff can change from the
 * admin without a code edit or deploy.
 *
 * DEFAULTS is the page exactly as it was before this was editable; anything
 * staff haven't set falls back to it, so a missing table, an empty row or a
 * failed read always leaves the page as it was. Text may contain {price},
 * which the site fills with the current price (so changing the price updates
 * every sentence that mentions it).
 *
 * Reads are cached in memory and refreshed at most every 30 seconds by
 * traffic (no timers); an update refreshes the cache at once on this server.
 */
const MAX_AGE_MS = 30 * 1000;

const DEFAULTS = Object.freeze({
  name: 'Hallos Millionaires Retreat 2026',
  description:
    'An all-expense paid retreat designed to help you gain practical life skills, accelerate your personal growth, and move your career forward with clarity. Connect with ambitious peers and take your next step with confidence.',
  startDate: '2026-12-09',
  endDate: '2026-12-11',
  dateLabel: '9th to 11th December',
  durationLabel: '2 days',
  locationLabel: 'Lagos, Nigeria',
  locality: 'Lagos',
  country: 'NG',
  image: '/images/event/speakers-hero.webp',
  imageAlt: 'Event speakers and hosts',
  registrationOpen: true,
  // The countdown runs to here (was a fixed 5 July 2026, already past).
  registrationDeadline: '2026-12-09T00:00:00+01:00',
  price: 3000,
  about: {
    valueProposition:
      'A 2-day, all-expense paid experience designed to help you gain practical life skills, accelerate your personal growth, and move your career forward with clarity.',
    perks: 'Gain real-world insights, connect with ambitious peers, and take your next step with confidence.',
    commitment: 'Open to individuals ready to take action. A {price} commitment fee applies to complete your registration.',
  },
  whyJoin: [
    { title: 'Accelerated Growth', description: 'Learn practical skills you can apply immediately' },
    { title: 'High-Value Networking', description: 'Connect with ambitious, like-minded individuals' },
    { title: 'Real-Life Skills', description: "Gain insights they don't teach in school" },
    { title: 'Clarity & Direction', description: 'Leave with a clear plan for your next phase' },
  ],
  whoCanApply: [
    'Growth-minded individuals',
    'Passionate learners',
    'Career-focused participants',
    'Must be available for the full 2-days',
  ],
  slots: {
    title: 'Limited slots available.',
    subtitle: "Don't miss this opportunity to fast-track your growth.",
  },
  faqs: [
    {
      question: 'How do I register for the event?',
      answer: 'Click any "Register" button on this page and complete the registration form. A {price} non-refundable commitment fee is required to secure your spot.',
    },
    {
      question: 'Is the event fully covered?',
      answer: 'Yes — once you are shortlisted among the participants, all expenses for the 2-day event including accommodation and meals are fully covered.',
    },
    {
      question: 'What happens after I register?',
      answer: 'After registering, you will receive a confirmation email with further instructions.',
    },
    {
      question: 'Can I transfer my slot to someone else?',
      answer: 'No. Participation in the program is non-transferable. Shortlisted slots cannot be transferred to another individual.',
    },
  ],
  journey: {
    title: 'Event Journey',
    subtitle: 'Relive every moment, from keynote to closing.',
    chapters: [
      {
        title: 'The Vision',
        description: 'An inspiring keynote that sets the stage for everything we are building together.',
        duration: 45,
        videoSrc: 'https://res.cloudinary.com/dblsgkbk4/video/upload/v1781269264/compressed_dklgv9.mp4',
        posterSrc: 'https://res.cloudinary.com/dblsgkbk4/image/upload/v1760131928/2148940744_1_y9chc5.png',
      },
      {
        title: 'Creator Stories',
        description: 'Real attendees share their transformative experiences and breakthrough moments.',
        duration: 52,
        videoSrc: 'https://res.cloudinary.com/dblsgkbk4/video/upload/v1781269264/compressed_dklgv9.mp4',
        posterSrc: 'https://res.cloudinary.com/dblsgkbk4/image/upload/v1760131928/2148940744_1_y9chc5.png',
      },
      {
        title: 'Skills Workshop',
        description: 'A hands-on deep dive into the tools and techniques that drive creative success.',
        duration: 38,
        videoSrc: 'https://res.cloudinary.com/dblsgkbk4/video/upload/v1781269264/compressed_dklgv9.mp4',
        posterSrc: 'https://res.cloudinary.com/dblsgkbk4/image/upload/v1760131928/2148940744_1_y9chc5.png',
      },
      {
        title: 'The Community',
        description: 'Networking, collaboration, and the closing moments that connect us all.',
        duration: 35,
        videoSrc: 'https://res.cloudinary.com/dblsgkbk4/video/upload/v1781269264/compressed_dklgv9.mp4',
        posterSrc: 'https://res.cloudinary.com/dblsgkbk4/image/upload/v1760131928/2148940744_1_y9chc5.png',
      },
    ],
  },
  form: {
    locations: ['Lagos', 'Abuja', 'Port Harcourt', 'Enugu', 'Kano', 'Other'],
    talents: ['Content Creator', 'Developer', 'Designer', 'Marketer', 'Other'],
    careerPaths: ['Freelancing', 'Full-time Job', 'Entrepreneurship', 'Other'],
  },
});

class FeaturedEventError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const isReady = () => require('../utils/ensureFeaturedEvent').isFeaturedEventReady();
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------- Reading ----------

let cache = { at: 0, stored: {}, updatedAt: null, updatedBy: null };
let loading = null;

async function load() {
  if (!isReady()) return;
  try {
    const [row] = await select(
      `SELECT s.content, s.updated_at AS "updatedAt", NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), '') AS "updatedBy"
         FROM featured_event_settings s LEFT JOIN "Users" u ON u.id = s.updated_by WHERE s.id = 1`
    );
    cache = { at: Date.now(), stored: row?.content || {}, updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || null };
  } catch (error) {
    cache.at = Date.now(); // don't hammer a failing database; keep what we had
    console.warn('[Featured event] Could not load settings:', error.message);
  }
}

function refreshIfStale(force = false) {
  if (loading || (!force && Date.now() - cache.at < MAX_AGE_MS)) return loading;
  loading = load().finally(() => {
    loading = null;
  });
  return loading;
}

/** Defaults with the stored values laid over them (objects merged, lists replaced). */
function merge(stored) {
  const out = clone(DEFAULTS);
  for (const [key, value] of Object.entries(stored || {})) {
    if (!(key in DEFAULTS) || value === undefined || value === null) continue;
    if (DEFAULTS[key] && typeof DEFAULTS[key] === 'object' && !Array.isArray(DEFAULTS[key]) && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...out[key], ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The event as the site should show it. Never throws. */
async function get() {
  if (cache.at === 0) await refreshIfStale(true);
  else refreshIfStale();
  return merge(cache.stored);
}

/** For the admin: the merged content plus who changed it last. */
async function getForAdmin() {
  await refreshIfStale(true);
  return { content: merge(cache.stored), defaults: clone(DEFAULTS), updatedAt: cache.updatedAt, updatedBy: cache.updatedBy, available: isReady() };
}

/** What a registration costs right now (₦). Falls back to the default. */
async function priceNgn() {
  const price = Number((await get()).price);
  return Number.isInteger(price) && price >= 100 ? price : DEFAULTS.price;
}

async function isRegistrationOpen() {
  return (await get()).registrationOpen !== false;
}

// ---------- Validation ----------

const text = (value, field, { max, min = 1, optional = false } = {}) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (optional) return '';
    throw new FeaturedEventError(400, `${field} can't be empty.`, field);
  }
  if (s.length < min) throw new FeaturedEventError(400, `${field} is too short.`, field);
  if (s.length > max) throw new FeaturedEventError(400, `${field} must be ${max} characters or fewer.`, field);
  return s;
};

/** A web address (https) or a path on the site (/images/...). Never javascript: or data:. */
const link = (value, field, { optional = false } = {}) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (optional) return '';
    throw new FeaturedEventError(400, `${field} is required.`, field);
  }
  if (s.length > 500) throw new FeaturedEventError(400, `${field} is too long.`, field);
  if (/^\/(?!\/)[\w\-./%]+$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.protocol === 'https:') return url.toString();
  } catch {}
  throw new FeaturedEventError(400, `${field} must start with https:// or be a path like /images/event/photo.webp.`, field);
};

const list = (value, field, { min, max }) => {
  if (!Array.isArray(value)) throw new FeaturedEventError(400, `${field} must be a list.`, field);
  if (value.length < min) throw new FeaturedEventError(400, `${field} needs at least ${min}.`, field);
  if (value.length > max) throw new FeaturedEventError(400, `${field} can have at most ${max}.`, field);
  return value;
};

const day = (value, field) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new FeaturedEventError(400, `${field} must be a date (YYYY-MM-DD).`, field);
  }
  return s;
};

const options = (value, field) => {
  const items = list(value, field, { min: 1, max: 30 }).map((item, i) => text(item, `${field} ${i + 1}`, { max: 60 }));
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.toLowerCase())) throw new FeaturedEventError(400, `${field} has "${item}" twice.`, field);
    seen.add(item.toLowerCase());
  }
  return items;
};

/** Checks and cleans a full content object. Throws FeaturedEventError with the field at fault. */
function validate(input) {
  const c = merge(input); // fill anything missing from the defaults
  const startDate = day(c.startDate, 'Start date');
  const endDate = day(c.endDate, 'End date');
  if (endDate < startDate) throw new FeaturedEventError(400, 'The end date must be on or after the start date.', 'End date');

  const deadlineAt = c.registrationDeadline ? new Date(c.registrationDeadline) : null;
  if (!deadlineAt || Number.isNaN(deadlineAt.getTime())) {
    throw new FeaturedEventError(400, 'Set a valid registration deadline (the countdown runs to it).', 'Registration deadline');
  }
  const registrationDeadline = deadlineAt.toISOString();

  const price = Number(c.price);
  if (!Number.isInteger(price) || price < 100 || price > 10000000) {
    throw new FeaturedEventError(400, 'The price must be a whole number of naira between ₦100 and ₦10,000,000.', 'Price');
  }

  const country = text(c.country, 'Country code', { max: 2, min: 2 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new FeaturedEventError(400, 'The country code must be two letters, like NG.', 'Country code');

  return {
    name: text(c.name, 'Event name', { max: 120, min: 3 }),
    description: text(c.description, 'Description', { max: 600, min: 10 }),
    startDate,
    endDate,
    dateLabel: text(c.dateLabel, 'Date label', { max: 60 }),
    durationLabel: text(c.durationLabel, 'Duration label', { max: 60 }),
    locationLabel: text(c.locationLabel, 'Location', { max: 120 }),
    locality: text(c.locality, 'City', { max: 80 }),
    country,
    image: link(c.image, 'Hero image'),
    imageAlt: text(c.imageAlt, 'Hero image description', { max: 160 }),
    registrationOpen: c.registrationOpen !== false,
    registrationDeadline,
    price,
    about: {
      valueProposition: text(c.about?.valueProposition, 'Value proposition', { max: 400 }),
      perks: text(c.about?.perks, 'Perks', { max: 400 }),
      commitment: text(c.about?.commitment, 'Commitment', { max: 400 }),
    },
    whyJoin: list(c.whyJoin, 'Why join', { min: 1, max: 8 }).map((item, i) => ({
      title: text(item?.title, `Why join ${i + 1} title`, { max: 60 }),
      description: text(item?.description, `Why join ${i + 1} description`, { max: 200 }),
    })),
    whoCanApply: list(c.whoCanApply, 'Who can apply', { min: 1, max: 10 }).map((item, i) => text(item, `Who can apply ${i + 1}`, { max: 120 })),
    slots: {
      title: text(c.slots?.title, 'Limited slots title', { max: 80 }),
      subtitle: text(c.slots?.subtitle, 'Limited slots subtitle', { max: 200 }),
    },
    faqs: list(c.faqs, 'FAQs', { min: 0, max: 20 }).map((item, i) => ({
      question: text(item?.question, `FAQ ${i + 1} question`, { max: 200 }),
      answer: text(item?.answer, `FAQ ${i + 1} answer`, { max: 1500 }),
    })),
    journey: {
      title: text(c.journey?.title, 'Event journey title', { max: 80 }),
      subtitle: text(c.journey?.subtitle, 'Event journey subtitle', { max: 200 }),
      chapters: list(c.journey?.chapters, 'Event journey videos', { min: 0, max: 12 }).map((item, i) => {
        const duration = Number(item?.duration);
        if (!Number.isInteger(duration) || duration < 1 || duration > 36000) {
          throw new FeaturedEventError(400, `Video ${i + 1} length must be a whole number of seconds.`, `Video ${i + 1} length`);
        }
        return {
          title: text(item?.title, `Video ${i + 1} title`, { max: 80 }),
          description: text(item?.description, `Video ${i + 1} description`, { max: 300 }),
          duration,
          videoSrc: link(item?.videoSrc, `Video ${i + 1} link`),
          posterSrc: link(item?.posterSrc, `Video ${i + 1} cover image`),
        };
      }),
    },
    form: {
      locations: options(c.form?.locations, 'Location options'),
      talents: options(c.form?.talents, 'Talent options'),
      careerPaths: options(c.form?.careerPaths, 'Career path options'),
    },
  };
}

// ---------- Saving ----------

async function update(input, actor) {
  if (!isReady()) throw new FeaturedEventError(503, 'Event settings are unavailable right now. Check the server logs.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FeaturedEventError(400, 'Send the event content.');
  const content = validate(input);
  await sequelize.query(
    `INSERT INTO featured_event_settings (id, content, updated_by, updated_at)
     VALUES (1, CAST(:content AS jsonb), :actorId, NOW())
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    { replacements: { content: JSON.stringify(content), actorId: actor.id } }
  );
  await refreshIfStale(true);
  console.log(`[Featured event] Updated by staff ${actor.id} (price ₦${content.price}, registration ${content.registrationOpen ? 'open' : 'closed'})`);
  return getForAdmin();
}

// ---------- Registrations ----------

const STATUSES = new Set(['pending', 'completed', 'failed']);

function registrationWhere({ status, search }) {
  const where = {};
  if (STATUSES.has(status)) where.paymentStatus = status;
  const term = String(search || '').trim().slice(0, 100);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where[Op.or] = [
      { firstName: { [Op.iLike]: like } },
      { lastName: { [Op.iLike]: like } },
      { email: { [Op.iLike]: like } },
      { phoneNumber: { [Op.iLike]: like } },
      { paymentReference: { [Op.iLike]: like } },
    ];
  }
  return where;
}

const REGISTRATION_FIELDS = [
  'id', 'firstName', 'lastName', 'email', 'phoneNumber', 'location', 'talent', 'jobDescription', 'whatToLearn',
  'paymentStatus', 'amount', 'currency', 'paymentReference', 'emailSent', 'createdAt',
];

async function listRegistrations({ status, search, page = 1, limit = 20 } = {}) {
  const CampaignRegistration = require('../models/CampaignRegistration');
  const size = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const current = Math.max(parseInt(page, 10) || 1, 1);
  const where = registrationWhere({ status, search });

  const [{ rows, count }, totals] = await Promise.all([
    CampaignRegistration.findAndCountAll({ where, attributes: REGISTRATION_FIELDS, order: [['createdAt', 'DESC']], limit: size, offset: (current - 1) * size, raw: true }),
    select(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE payment_status = 'completed')::int AS paid,
              COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE payment_status = 'failed')::int AS failed,
              COALESCE(SUM(amount) FILTER (WHERE payment_status = 'completed'), 0)::float AS revenue
         FROM campaign_registrations`
    ),
  ]);
  return {
    items: rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    pagination: { total: count, page: current, limit: size, totalPages: Math.max(Math.ceil(count / size), 1) },
    stats: totals[0] || { total: 0, paid: 0, pending: 0, failed: 0, revenue: 0 },
  };
}

/** Spreadsheet-safe CSV cell (also defuses formulas: =, +, -, @ at the start). */
const csvCell = (value) => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportRegistrationsCsv({ status, search } = {}) {
  const CampaignRegistration = require('../models/CampaignRegistration');
  const rows = await CampaignRegistration.findAll({
    where: registrationWhere({ status, search }),
    attributes: REGISTRATION_FIELDS,
    order: [['createdAt', 'DESC']],
    limit: 50000,
    raw: true,
  });
  const header = ['Registered at (UTC)', 'First name', 'Last name', 'Email', 'Phone', 'Location', 'Talent', 'About them', 'Why join', 'Payment status', 'Amount', 'Currency', 'Reference', 'Email sent'];
  const lines = rows.map((r) =>
    [
      new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 19),
      r.firstName, r.lastName, r.email, r.phoneNumber, r.location, r.talent, r.jobDescription, r.whatToLearn,
      r.paymentStatus, Number(r.amount).toFixed(2), r.currency, r.paymentReference, r.emailSent ? 'yes' : 'no',
    ].map(csvCell).join(',')
  );
  return { csv: '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n'), count: rows.length };
}

module.exports = {
  DEFAULTS,
  FeaturedEventError,
  get,
  getForAdmin,
  priceNgn,
  isRegistrationOpen,
  validate,
  update,
  listRegistrations,
  exportRegistrationsCsv,
  startRefreshing: () => refreshIfStale(true),
};
