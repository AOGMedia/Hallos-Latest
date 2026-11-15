const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * "Download my data": a copy of everything stored against a person, as one
 * machine-readable JSON file (the privacy policy promises this).
 *
 * Rather than a hand-kept list that goes stale as features are added, it
 * finds every table with a column that points to the person (user_id,
 * creator_id, host_id, ...) and includes their rows. Left out on purpose:
 * secrets (password, token, code, hash and similar columns), staff-only
 * records, and short-lived sign-up/OTP tables. Each table is capped at
 * ROW_LIMIT rows so one very active account can't produce a huge file.
 *
 * Built on demand, no background job. People can download once every
 * COOLDOWN_MS; staff exports (for support requests) aren't limited.
 */
const ROW_LIMIT = 5000;
const COOLDOWN_MS = 10 * 60 * 1000;

/** Columns that mean "this row belongs to that person". */
const OWNER_COLUMNS = [
  'user_id', 'userId', 'creator_id', 'creatorId', 'host_id', 'hostId', 'owner_id', 'ownerId',
  'author_id', 'authorId', 'sender_id', 'senderId', 'buyer_id', 'buyerId', 'viewer_id', 'viewerId',
  'referrer_id', 'referrerId', 'referred_user_id', 'referredUserId', 'member_id', 'memberId',
  'participant_id', 'participantId', 'player_id', 'playerId', 'inviter_id', 'inviterId', 'student_id', 'studentId',
];

/** Staff-only, internal or secret tables. */
const SKIP_TABLE = /^(Users|SequelizeMeta|admin_|staff_|withdrawal_otps|pending_signups|password_reset|sessions?$)/i;
/** Secret columns, never exported. */
const SECRET_COLUMN = /(password|passcode|token|secret|otp|hash|signature|api_?key|authorization|cvv|^pin$|webhook)/i;
const INT_TYPES = new Set(['integer', 'bigint', 'smallint', 'numeric']);
const TEXT_TYPES = new Set(['character varying', 'text', 'character']);

class DataExportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;
const lastExport = new Map();

const strip = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !SECRET_COLUMN.test(key)));

/** Tables that hold this person's rows, with the matching columns. Cached briefly; the schema rarely changes. */
let tablesCache = { at: 0, tables: [] };
async function ownedTables() {
  if (Date.now() - tablesCache.at < 10 * 60 * 1000 && tablesCache.tables.length) return tablesCache.tables;
  const rows = await select(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name IN (:owners)`,
    { owners: OWNER_COLUMNS }
  );
  const byTable = new Map();
  for (const row of rows) {
    if (SKIP_TABLE.test(row.table_name)) continue;
    if (!INT_TYPES.has(row.data_type) && !TEXT_TYPES.has(row.data_type)) continue;
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
    byTable.get(row.table_name).push({ column: row.column_name, text: TEXT_TYPES.has(row.data_type) });
  }
  const tables = [...byTable.entries()].map(([table, columns]) => ({ table, columns })).sort((a, b) => a.table.localeCompare(b.table));
  tablesCache = { at: Date.now(), tables };
  return tables;
}

async function build(userId) {
  const id = Number(userId);
  const [user] = await select('SELECT * FROM "Users" WHERE id = :id', { id });
  if (!user) throw new DataExportError(404, 'Account not found.');

  const data = {};
  const truncated = [];
  for (const { table, columns } of await ownedTables()) {
    const where = columns.map((c) => `${quote(c.column)} = ${c.text ? ':idText' : ':id'}`).join(' OR ');
    try {
      const rows = await select(`SELECT * FROM ${quote(table)} WHERE ${where} LIMIT ${ROW_LIMIT + 1}`, { id, idText: String(id) });
      if (rows.length === 0) continue;
      if (rows.length > ROW_LIMIT) truncated.push(table);
      data[table] = rows.slice(0, ROW_LIMIT).map(strip);
    } catch (error) {
      console.warn(`[Data export] Skipped ${table}:`, error.message);
    }
  }

  return {
    about: {
      service: 'Hallos',
      generatedAt: new Date().toISOString(),
      note:
        'Everything stored against your account. Passwords, sign-in tokens and security codes are left out. ' +
        (truncated.length ? `These sections show your latest ${ROW_LIMIT} entries only: ${truncated.join(', ')}. ` : '') +
        'Questions: support@hallos.net',
    },
    account: strip(user),
    data,
  };
}

/** For the person themselves (rate limited). */
async function exportForSelf(userId) {
  const last = lastExport.get(Number(userId)) || 0;
  const wait = COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) {
    throw new DataExportError(429, `You just downloaded your data. You can download it again in ${Math.ceil(wait / 60000)} minute${wait > 60000 ? 's' : ''}.`);
  }
  const result = await build(userId);
  lastExport.set(Number(userId), Date.now());
  if (lastExport.size > 5000) lastExport.clear(); // keep memory bounded
  return result;
}

/** For staff handling a support request (logged by the staff action log). */
const exportForStaff = (userId) => build(userId);

const fileName = (userId) => `hallos-data-${userId}-${new Date().toISOString().slice(0, 10)}.json`;

module.exports = { DataExportError, exportForSelf, exportForStaff, fileName };
