/**
 * Crediting a partner for a new Google sign-up (claim after first login), and
 * that the existing sign-up linking behaves as before. Models are mocked —
 * needs no database.
 */

const mockCodes = [];
const mockLinks = [];
const mockUsers = new Map();

jest.mock('../config/db', () => ({}));
jest.mock('../models/ReferralCommission', () => ({}));
jest.mock('../models/User', () => ({
  findByPk: jest.fn(async (id) => mockUsers.get(Number(id)) || null)
}));
jest.mock('../models/ReferralCode', () => ({
  findOne: jest.fn(async ({ where }) => {
    const now = new Date();
    return (
      mockCodes.find(
        (c) =>
          c.referralCode === where.referralCode &&
          (!where.status || c.status === where.status) &&
          (!where.expiresAt || c.expiresAt > now)
      ) || null
    );
  })
}));
jest.mock('../models/UserReferral', () => ({
  create: jest.fn(async (fields) => {
    if (mockLinks.some((l) => l.creatorUserId === fields.creatorUserId)) {
      throw Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' });
    }
    mockLinks.push(fields);
    return fields;
  })
}));

const referralService = require('../services/referralService');

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);
const addCode = (overrides = {}) => {
  const code = {
    id: 'c1',
    referralCode: 'PARTNER1',
    partnerUserId: 100,
    status: 'active',
    expiresAt: new Date(Date.now() + 86_400_000),
    successfulReferrals: 0,
    ...overrides
  };
  code.increment = jest.fn(async (field) => {
    code[field] += 1;
  });
  mockCodes.push(code);
  return code;
};

beforeEach(() => {
  mockCodes.length = 0;
  mockLinks.length = 0;
  mockUsers.clear();
  jest.clearAllMocks();
});

describe('claimSignupReferral (Google sign-up)', () => {
  test('a brand-new account is linked and the partner is credited', async () => {
    const code = addCode();
    mockUsers.set(7, { id: 7, createdAt: minutesAgo(1) });
    expect(await referralService.claimSignupReferral(7, 'PARTNER1')).toEqual({ linked: true });
    expect(mockLinks).toEqual([expect.objectContaining({ creatorUserId: 7, partnerUserId: 100, referralCode: 'PARTNER1' })]);
    expect(code.successfulReferrals).toBe(1);
  });

  test('an existing (older) account cannot attach itself to a partner', async () => {
    addCode();
    mockUsers.set(7, { id: 7, createdAt: minutesAgo(45) });
    expect(await referralService.claimSignupReferral(7, 'PARTNER1')).toEqual({ linked: false, reason: 'NOT_NEW' });
    expect(mockLinks).toHaveLength(0);
  });

  test('an account already linked stays with its partner', async () => {
    addCode();
    addCode({ id: 'c2', referralCode: 'OTHER', partnerUserId: 200 });
    mockUsers.set(7, { id: 7, createdAt: minutesAgo(1) });
    await referralService.claimSignupReferral(7, 'PARTNER1');
    expect(await referralService.claimSignupReferral(7, 'OTHER')).toEqual({ linked: false, reason: 'NOT_LINKED' });
    expect(mockLinks).toHaveLength(1);
    expect(mockLinks[0].partnerUserId).toBe(100);
  });

  test('a partner cannot refer themselves', async () => {
    addCode({ partnerUserId: 7 });
    mockUsers.set(7, { id: 7, createdAt: minutesAgo(1) });
    expect(await referralService.claimSignupReferral(7, 'PARTNER1')).toEqual({ linked: false, reason: 'OWN_CODE' });
  });

  test.each([
    ['unknown code', 'NOPE'],
    ['empty code', ''],
    ['very long code', 'X'.repeat(101)]
  ])('%s is ignored', async (_label, ref) => {
    mockUsers.set(7, { id: 7, createdAt: minutesAgo(1) });
    const result = await referralService.claimSignupReferral(7, ref);
    expect(result.linked).toBe(false);
    expect(mockLinks).toHaveLength(0);
  });

  test('inactive and expired codes are ignored (same rules as before)', async () => {
    addCode({ status: 'inactive' });
    addCode({ id: 'c3', referralCode: 'OLD', expiresAt: minutesAgo(1) });
    mockUsers.set(7, { id: 7, createdAt: minutesAgo(1) });
    expect((await referralService.claimSignupReferral(7, 'PARTNER1')).linked).toBe(false);
    expect((await referralService.claimSignupReferral(7, 'OLD')).linked).toBe(false);
  });

  test('a database error never throws', async () => {
    require('../models/User').findByPk.mockRejectedValueOnce(new Error('db down'));
    expect(await referralService.claimSignupReferral(7, 'PARTNER1')).toEqual({ linked: false, reason: 'ERROR' });
  });
});

describe('linkCreatorAtSignup (email sign-up) — unchanged behaviour', () => {
  test('links and returns true; a second link is ignored and returns false', async () => {
    addCode();
    expect(await referralService.linkCreatorAtSignup(9, 'PARTNER1')).toBe(true);
    expect(await referralService.linkCreatorAtSignup(9, 'PARTNER1')).toBe(false);
    expect(mockLinks).toHaveLength(1);
  });
});
