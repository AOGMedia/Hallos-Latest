/**
 * Gifts attendees can send a host during a GetStream live class or series
 * session. The server is the only source of prices — the browser just sends
 * a gift code.
 *
 * Prices are in currency units. An attendee pays from whichever wallet has
 * enough (the class's currency first, then the other). The host receives
 * HOST_SHARE_PERCENT of it; the rest is Hallos's platform fee.
 */

const HOST_SHARE_PERCENT = 80; // platform keeps 20%

const LIVE_GIFTS = [
  { code: 'spark', name: 'Spark', emoji: '⭐', animation: 'pop', prices: { NGN: 100, USD: 0.1 } },
  { code: 'love', name: 'Love', emoji: '❤️', animation: 'heartbeat', prices: { NGN: 200, USD: 0.2 } },
  { code: 'rose', name: 'Rose', emoji: '🌹', animation: 'bloom', prices: { NGN: 300, USD: 0.3 } },
  { code: 'champion', name: 'Champion', emoji: '🏆', animation: 'bounce', prices: { NGN: 500, USD: 0.5 } },
  { code: 'rocket', name: 'Rocket', emoji: '🚀', animation: 'fly', prices: { NGN: 1000, USD: 1 } },
  { code: 'diamond', name: 'Diamond', emoji: '💎', animation: 'shine', prices: { NGN: 2500, USD: 2.5 } },
  { code: 'crown', name: 'Crown', emoji: '👑', animation: 'crown', prices: { NGN: 5000, USD: 5 } }
];

const giftByCode = (code) => LIVE_GIFTS.find((g) => g.code === code) || null;

module.exports = { LIVE_GIFTS, HOST_SHARE_PERCENT, giftByCode };
