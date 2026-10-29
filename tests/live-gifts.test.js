/**
 * Live gifts (GetStream rooms) and chat photo helpers.
 * Database models are replaced with an in-memory fake — no DB needed.
 */

const mockWallets = [];
const mockHistory = [];
const mockGifts = [];

const mockMatches = (row, where) =>
  Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v));

jest.mock('../config/db', () => ({
  transaction: async (fn) => {
    // Snapshot so a thrown error rolls everything back, like Postgres.
    const snapshot = {
      wallets: mockWallets.map((w) => ({ ...w })),
      history: mockHistory.length,
      gifts: mockGifts.length
    };
    try {
      return await fn({ LOCK: { UPDATE: 'UPDATE' } });
    } catch (error) {
      snapshot.wallets.forEach((saved, i) => Object.assign(mockWallets[i], saved));
      mockWallets.length = snapshot.wallets.length;
      mockHistory.length = snapshot.history;
      mockGifts.length = snapshot.gifts;
      throw error;
    }
  },
  fn: () => null,
  col: () => null
}));

jest.mock('../models/WalletAccount', () => {
  const wrap = (row) => ({
    ...row,
    async update(fields) {
      Object.assign(row, fields);
      Object.assign(this, fields);
    }
  });
  return {
    findOrCreate: jest.fn(async ({ where, defaults }) => {
      let row = mockWallets.find((w) => mockMatches(w, where));
      if (!row) {
        row = { id: `w-${mockWallets.length + 1}`, ...defaults };
        mockWallets.push(row);
      }
      return [wrap(row), false];
    }),
    findAll: jest.fn(async ({ where }) => mockWallets.filter((w) => mockMatches(w, where)).map(wrap))
  };
});

jest.mock('../models/WalletTransaction', () => ({
  create: jest.fn(async (row) => {
    mockHistory.push(row);
    return row;
  })
}));

jest.mock('../models/LiveGift', () => ({
  findOne: jest.fn(async ({ where }) => mockGifts.find((g) => mockMatches(g, where)) || null),
  findAll: jest.fn(async () => []),
  create: jest.fn(async (row) => {
    mockGifts.push(row);
    return row;
  })
}));

const { liveGiftService, currencyPreference } = require('../services/liveGiftService');
const { sniffImageType, folderFor } = require('../services/liveChatMediaService');

const ATTENDEE = 21;
const HOST = 7;
const base = {
  senderId: ATTENDEE,
  recipientId: HOST,
  contentType: 'live_class',
  contentId: '0b6c7c5e-1111-4222-8333-944455556666',
  contentCurrency: 'NGN'
};
let tap = 0;
const send = (overrides = {}) =>
  liveGiftService.sendGift({ ...base, giftCode: 'rose', idempotencyKey: `tap-${++tap}`, ...overrides });

const fund = (userId, currency, major) =>
  mockWallets.push({ id: `w-${mockWallets.length + 1}`, user_id: userId, currency, balance_available: major * 100, balance_pending: 0 });
const balance = (userId, currency) => {
  const w = mockWallets.find((x) => x.user_id === userId && x.currency === currency);
  return w ? w.balance_available / 100 : 0;
};

beforeEach(() => {
  mockWallets.length = 0;
  mockHistory.length = 0;
  mockGifts.length = 0;
});

describe('sending a gift', () => {
  test('moves money from the attendee to the host, keeping a 20% platform fee', async () => {
    fund(ATTENDEE, 'NGN', 1000);
    const { gift, replay } = await send({ giftCode: 'rose' }); // ₦300

    expect(replay).toBe(false);
    expect(balance(ATTENDEE, 'NGN')).toBe(700);
    expect(balance(HOST, 'NGN')).toBe(240);
    expect(gift).toMatchObject({ currency: 'NGN', amount: 30000, hostAmount: 24000, platformFee: 6000, giftCode: 'rose' });
  });

  test('writes a history row for both people, as transfers (not top-ups)', async () => {
    fund(ATTENDEE, 'NGN', 1000);
    await send();
    expect(mockHistory.map((h) => [h.transaction_type, h.amount])).toEqual([
      ['transfer_out', 30000],
      ['transfer_in', 24000]
    ]);
    expect(mockHistory.every((h) => h.reference.length <= 50)).toBe(true);
  });

  test('uses the class currency first, then the other wallet', async () => {
    fund(ATTENDEE, 'NGN', 50); // not enough for a ₦300 rose
    fund(ATTENDEE, 'USD', 10);
    const { gift } = await send({ giftCode: 'rose' });
    expect(gift.currency).toBe('USD');
    expect(balance(ATTENDEE, 'USD')).toBeCloseTo(9.7);
    expect(balance(ATTENDEE, 'NGN')).toBe(50);
    expect(currencyPreference('USD')).toEqual(['USD', 'NGN']);
  });

  test('refuses when no wallet has enough, and changes nothing', async () => {
    fund(ATTENDEE, 'NGN', 50);
    await expect(send({ giftCode: 'crown' })).rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_FUNDS' });
    expect(balance(ATTENDEE, 'NGN')).toBe(50);
    expect(mockHistory).toHaveLength(0);
    expect(mockGifts).toHaveLength(0);
  });

  test('a repeated tap (same key) never charges twice', async () => {
    fund(ATTENDEE, 'NGN', 1000);
    const first = await send({ idempotencyKey: 'same-tap' });
    const again = await send({ idempotencyKey: 'same-tap' });
    expect(again.replay).toBe(true);
    expect(again.gift.id).toBe(first.gift.id);
    expect(balance(ATTENDEE, 'NGN')).toBe(700);
  });

  test('rejects unknown gifts, self-gifts and missing keys', async () => {
    fund(ATTENDEE, 'NGN', 1000);
    await expect(send({ giftCode: 'free-money' })).rejects.toMatchObject({ code: 'UNKNOWN_GIFT' });
    await expect(send({ recipientId: ATTENDEE })).rejects.toMatchObject({ code: 'SELF_GIFT' });
    await expect(send({ idempotencyKey: '' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(balance(ATTENDEE, 'NGN')).toBe(1000);
  });

  test('every gift splits exactly: host share + platform fee = price', async () => {
    fund(ATTENDEE, 'NGN', 100000);
    for (const { code } of liveGiftService.catalog()) {
      const { gift } = await send({ giftCode: code });
      expect(gift.hostAmount + gift.platformFee).toBe(gift.amount);
      expect(gift.platformFee / gift.amount).toBeCloseTo(0.2, 2);
    }
  });
});

describe('who a gift can go to', () => {
  const { resolveRecipient } = require('../services/giftRecipients');
  const members = { 7: 'host', 8: 'cohost', 21: 'attendee', 22: 'attendee' };
  const target = { hostUserId: 7, roleOf: async (id) => members[id] || null };

  test('attendees always gift the host — and can only gift the host', async () => {
    expect(await resolveRecipient(target, 'attendee', 21, undefined)).toEqual({ recipientId: 7 });
    expect(await resolveRecipient(target, 'attendee', 21, 7)).toEqual({ recipientId: 7 });
    expect((await resolveRecipient(target, 'attendee', 21, 22)).error).toMatch(/host/);
  });

  test('hosts and co-hosts gift a participant they choose', async () => {
    expect(await resolveRecipient(target, 'host', 7, '21')).toEqual({ recipientId: 21 });
    expect(await resolveRecipient(target, 'cohost', 8, 22)).toEqual({ recipientId: 22 });
    expect(await resolveRecipient(target, 'cohost', 8, 7)).toEqual({ recipientId: 7 });
  });

  test('hosts must pick someone in the class, and not themselves', async () => {
    expect((await resolveRecipient(target, 'host', 7, undefined)).error).toMatch(/Choose/);
    expect((await resolveRecipient(target, 'host', 7, 7)).error).toMatch(/yourself/);
    expect((await resolveRecipient(target, 'host', 7, 999)).error).toMatch(/isn't part of this class/);
    expect((await resolveRecipient(target, 'host', 7, 'abc')).error).toMatch(/Choose/);
  });
});

describe('chat photos', () => {
  test('recognises real images by their bytes, not their name', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImageType(jpeg)).toMatchObject({ mime: 'image/jpeg' });
    expect(sniffImageType(png)).toMatchObject({ mime: 'image/png' });
    expect(sniffImageType(svg)).toBeNull();
  });

  test('each class/session gets its own folder (deleted together after class)', () => {
    expect(folderFor({ kind: 'class', id: 'abc' })).toBe('live-chat/class-abc/');
    expect(folderFor({ kind: 'session', id: 'abc' })).toBe('live-chat/session-abc/');
  });
});
