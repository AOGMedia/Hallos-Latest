/**
 * Email-verified sign-up: start → code → account. Models, DNS and email are
 * mocked — needs no database, network or mail server.
 */
process.env.JWT_SECRET_KEY = 'test-secret';

const mockUsers = [];
const mockPending = [];
const mockSent = [];

function mockRow(fields) {
  const row = {
    ...fields,
    update: jest.fn(async (changes) => Object.assign(row, changes)),
    destroy: jest.fn(async () => {
      const i = mockPending.indexOf(row);
      if (i >= 0) mockPending.splice(i, 1);
    }),
    increment: jest.fn(async (field) => {
      row[field] += 1;
    })
  };
  return row;
}

jest.mock('../models/User', () => ({
  findOne: jest.fn(async ({ where }) => {
    // where(fn('lower', col('email')), key) — read the compared value.
    const key = where?.logic ?? where?.email;
    return mockUsers.find((u) => u.email.toLowerCase() === String(key).toLowerCase()) || null;
  }),
  create: jest.fn(async (fields) => {
    if (mockUsers.some((u) => u.email.toLowerCase() === fields.email.toLowerCase())) {
      const { UniqueConstraintError } = jest.requireActual('sequelize');
      throw new UniqueConstraintError({});
    }
    const user = { id: mockUsers.length + 1, role: 'viewer', ...fields };
    mockUsers.push(user);
    return user;
  })
}));

jest.mock('../models/PendingSignup', () => ({
  findOne: jest.fn(async ({ where }) => mockPending.find((p) => p.emailKey === where.emailKey) || null),
  create: jest.fn(async (fields) => {
    if (mockPending.some((p) => p.emailKey === fields.emailKey)) {
      const { UniqueConstraintError } = jest.requireActual('sequelize');
      throw new UniqueConstraintError({});
    }
    const row = mockRow({ id: `p${mockPending.length + 1}`, ...fields });
    mockPending.push(row);
    return row;
  }),
  destroy: jest.fn(async () => 0)
}));

jest.mock('../utils/email', () => ({
  sendSignupVerificationCode: jest.fn(async (to, firstname, code) => mockSent.push({ to, code }))
}));

const mockResolveMx = jest.fn();
const mockResolve4 = jest.fn();
const mockResolve6 = jest.fn();
jest.mock('dns', () => ({
  promises: {
    resolveMx: (...a) => mockResolveMx(...a),
    resolve4: (...a) => mockResolve4(...a),
    resolve6: (...a) => mockResolve6(...a)
  }
}));

const bcrypt = require('bcryptjs');
const service = require('../services/signupVerificationService');
const { domainAcceptsMail, isDisposableEmail } = require('../utils/emailDomainCheck');

const details = {
  firstname: 'Ada',
  lastname: 'Obi',
  email: 'Ada@Example.com',
  password: 'secret123',
  referralCode: 'REF1',
  quizInviteToken: null
};
const lastCode = () => mockSent[mockSent.length - 1].code;
const noData = () => Object.assign(new Error('no data'), { code: 'ENODATA' });

beforeEach(() => {
  mockUsers.length = 0;
  mockPending.length = 0;
  mockSent.length = 0;
  jest.clearAllMocks();
  mockResolveMx.mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]);
  mockResolve4.mockRejectedValue(noData());
  mockResolve6.mockRejectedValue(noData());
});

describe('start', () => {
  test('holds the sign-up and emails a 6-digit code; no account yet', async () => {
    const result = await service.startSignup(details);
    expect(result).toEqual({ email: 'Ada@Example.com', expiresInMinutes: 15, resendAfterSeconds: 60 });
    expect(mockUsers).toHaveLength(0);
    expect(mockPending).toHaveLength(1);
    expect(mockPending[0].emailKey).toBe('ada@example.com');
    expect(mockSent[0]).toEqual({ to: 'Ada@Example.com', code: expect.stringMatching(/^\d{6}$/) });
    // The code itself is never stored, and the password is hashed.
    expect(JSON.stringify(mockPending[0])).not.toContain(lastCode());
    expect(await bcrypt.compare('secret123', mockPending[0].passwordHash)).toBe(true);
  });

  test('an email that already has an account (any case) is refused', async () => {
    mockUsers.push({ id: 9, email: 'ada@example.com' });
    await expect(service.startSignup(details)).rejects.toMatchObject({ status: 400, code: 'EMAIL_IN_USE' });
    expect(mockSent).toHaveLength(0);
  });

  test('throwaway inboxes are refused', async () => {
    await expect(service.startSignup({ ...details, email: 'x@mailinator.com' })).rejects.toMatchObject({
      code: 'DISPOSABLE_EMAIL'
    });
    expect(isDisposableEmail('a@inbox.mailinator.com')).toBe(true);
    expect(isDisposableEmail('a@gmail.com')).toBe(false);
  });

  test('a domain that cannot receive mail is refused', async () => {
    mockResolveMx.mockRejectedValue(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
    mockResolve4.mockRejectedValue(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
    await expect(service.startSignup({ ...details, email: 'a@gmial.con' })).rejects.toMatchObject({
      code: 'EMAIL_DOMAIN_INVALID'
    });
  });

  test('signing up again within a minute keeps the latest details but sends no new code', async () => {
    await service.startSignup(details);
    const result = await service.startSignup({ ...details, firstname: 'Adaeze' });
    expect(mockSent).toHaveLength(1);
    expect(mockPending[0].firstname).toBe('Adaeze');
    expect(result.resendAfterSeconds).toBeGreaterThan(0);
  });

  test('a failed email lets them retry straight away', async () => {
    require('../utils/email').sendSignupVerificationCode.mockRejectedValueOnce(new Error('brevo down'));
    await expect(service.startSignup(details)).rejects.toMatchObject({ status: 502, code: 'EMAIL_SEND_FAILED' });
    await service.resendCode({ email: details.email });
    expect(mockSent).toHaveLength(1);
  });
});

describe('domain check fails open', () => {
  test('DNS trouble allows the address', async () => {
    mockResolveMx.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }));
    expect(await domainAcceptsMail('a@example.com')).toBe(true);
  });
  test('no MX but an address record still receives mail', async () => {
    mockResolveMx.mockRejectedValue(noData());
    mockResolve4.mockResolvedValue(['1.2.3.4']);
    expect(await domainAcceptsMail('a@example.com')).toBe(true);
  });
});

describe('verify', () => {
  test('the right code creates the account exactly as before and clears the pending sign-up', async () => {
    await service.startSignup(details);
    const { user, referralCode } = await service.verifySignup({ email: 'ada@example.com', code: lastCode() });
    expect(user).toMatchObject({ firstname: 'Ada', lastname: 'Obi', email: 'Ada@Example.com' });
    expect(await bcrypt.compare('secret123', user.password)).toBe(true);
    expect(referralCode).toBe('REF1');
    expect(mockPending).toHaveLength(0);
  });

  test('accepts the code with spaces', async () => {
    await service.startSignup(details);
    const spaced = lastCode().replace(/(\d{3})/, '$1 ');
    await expect(service.verifySignup({ email: details.email, code: spaced })).resolves.toHaveProperty('user');
  });

  test('a wrong code counts down, then locks until a new code', async () => {
    await service.startSignup(details);
    for (let i = 4; i >= 0; i--) {
      await expect(service.verifySignup({ email: details.email, code: '000000' === lastCode() ? '111111' : '000000' }))
        .rejects.toMatchObject({ code: 'INVALID_CODE', attemptsRemaining: i });
    }
    await expect(service.verifySignup({ email: details.email, code: lastCode() })).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS'
    });
    expect(mockUsers).toHaveLength(0);
  });

  test('an expired code is refused', async () => {
    await service.startSignup(details);
    mockPending[0].codeExpiresAt = new Date(Date.now() - 1000);
    await expect(service.verifySignup({ email: details.email, code: lastCode() })).rejects.toMatchObject({
      code: 'CODE_EXPIRED'
    });
  });

  test('no pending sign-up means starting again', async () => {
    await expect(service.verifySignup({ email: 'nobody@example.com', code: '123456' })).rejects.toMatchObject({
      status: 410,
      code: 'SIGNUP_EXPIRED'
    });
  });

  test('if the email got an account meanwhile (e.g. Google), no duplicate is made', async () => {
    await service.startSignup(details);
    mockUsers.push({ id: 5, email: 'ada@example.com' });
    await expect(service.verifySignup({ email: details.email, code: lastCode() })).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_IN_USE'
    });
    expect(mockUsers).toHaveLength(1);
  });
});

describe('resend', () => {
  test('too soon is refused with the wait time', async () => {
    await service.startSignup(details);
    await expect(service.resendCode({ email: details.email })).rejects.toMatchObject({
      code: 'RESEND_TOO_SOON',
      resendAfterSeconds: expect.any(Number)
    });
  });

  test('after the cooldown a new code replaces the old one and resets attempts', async () => {
    await service.startSignup(details);
    const first = lastCode();
    mockPending[0].lastSentAt = new Date(Date.now() - 61_000);
    mockPending[0].attempts = 3;
    await service.resendCode({ email: details.email });
    expect(mockPending[0].attempts).toBe(0);
    if (lastCode() !== first) {
      await expect(service.verifySignup({ email: details.email, code: first })).rejects.toMatchObject({ code: 'INVALID_CODE' });
    }
    await expect(service.verifySignup({ email: details.email, code: lastCode() })).resolves.toHaveProperty('user');
  });

  test('at most 5 codes an hour', async () => {
    await service.startSignup(details);
    for (let i = 0; i < 4; i++) {
      mockPending[0].lastSentAt = new Date(Date.now() - 61_000);
      await service.resendCode({ email: details.email });
    }
    mockPending[0].lastSentAt = new Date(Date.now() - 61_000);
    await expect(service.resendCode({ email: details.email })).rejects.toMatchObject({ code: 'TOO_MANY_CODES' });
  });
});
