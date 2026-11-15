/**
 * Who used Hallos on which day, for active-user and retention numbers.
 *
 * Signed-in requests already pass through authMiddleware; it calls
 * noteActive(userId). The first request from a person each day writes one
 * row (user_daily_activity, ON CONFLICT DO NOTHING); every later request that
 * day is answered from an in-memory set and costs nothing. No timers.
 *
 * Days are UTC days: Hallos is used worldwide, so one global day boundary is
 * the standard and keeps numbers comparable whichever country people are in.
 * Never throws and never delays the request: a failure just means one
 * person's day isn't counted.
 */
const sequelize = require('../config/db');

const MAX_SEEN = 500000; // memory guard: start over rather than grow forever

let ready = false;
let today = null;
let seen = new Set();

const dayKey = (time = Date.now()) => new Date(time).toISOString().slice(0, 10); // UTC

function noteActive(userId) {
  try {
    const id = Number(userId);
    if (!ready || !Number.isInteger(id) || id <= 0) return;
    const day = dayKey();
    if (day !== today || seen.size > MAX_SEEN) {
      today = day;
      seen = new Set();
    }
    if (seen.has(id)) return;
    seen.add(id);
    sequelize
      .query('INSERT INTO user_daily_activity (user_id, day) VALUES (:id, :day) ON CONFLICT DO NOTHING', { replacements: { id, day } })
      .catch((error) => {
        seen.delete(id); // try again on their next request
        console.warn('[Activity] Could not record activity:', error.message);
      });
  } catch {
    // never affect the request
  }
}

const start = () => {
  ready = true;
};

module.exports = { noteActive, dayKey, start, isReady: () => ready };
