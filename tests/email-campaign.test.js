process.env.JWT_SECRET_KEY = 'test-secret';
process.env.EMAIL_UNSUBSCRIBE_BASE_URL = 'https://api.example.test';

const {
  sanitizeCampaignHtml,
  applyMergeTags,
  buildMergeVars,
  signEmail,
  verifyEmailToken,
  buildUnsubscribeUrl,
  decodeEmailParam,
  renderCampaignEmail,
  htmlToText
} = require('../utils/campaignEmail');
const { normalizeAudience, resolveSignupRange, buildWhere } = require('../services/emailAudienceService');
const { classifyError } = require('../services/emailCampaignWorker');

const UUID = '9c9a9fe6-33cb-4c3b-9338-951217c6d56e';

describe('sanitizeCampaignHtml', () => {
  it('removes scripts, inline handlers and javascript: links', () => {
    const dirty = '<p onclick="x()">Hi<script>alert(1)</script></p><a href="javascript:alert(1)">go</a><iframe src="https://evil"></iframe>';
    const clean = sanitizeCampaignHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|javascript:|iframe/i);
    expect(clean).toContain('Hi');
  });

  it('drops data: image sources but keeps https images and basic formatting', () => {
    const clean = sanitizeCampaignHtml('<img src="data:image/png;base64,AAAA"><img src="https://cdn.test/a.png" alt="a"><strong>bold</strong>');
    expect(clean).not.toContain('data:');
    expect(clean).toContain('https://cdn.test/a.png');
    expect(clean).toContain('<strong>bold</strong>');
  });

  it('keeps merge tags inside link hrefs and adds rel/target', () => {
    const clean = sanitizeCampaignHtml('<a href="{{unsubscribeUrl}}">stop</a><a href="https://hallos.net">site</a>');
    expect(clean).toContain('{{unsubscribeUrl}}');
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  it('blocks url() in inline styles', () => {
    expect(sanitizeCampaignHtml('<p style="background-color:red;background:url(http://x)">t</p>')).not.toContain('url(');
  });
});

describe('applyMergeTags', () => {
  const vars = buildMergeVars({ firstName: 'Ada', lastName: 'Okafor', email: 'ada@x.com' }, 'https://u');

  it('fills known tags case-insensitively', () => {
    expect(applyMergeTags('Hi {{firstName}} {{ LASTNAME }} ({{email}})', vars)).toBe('Hi Ada Okafor (ada@x.com)');
  });

  it('uses the fallback only when the value is empty', () => {
    const empty = buildMergeVars({ firstName: '', email: 'a@b.co' }, '');
    expect(applyMergeTags('Hi {{firstName|there}}', empty)).toBe('Hi there');
    expect(applyMergeTags('Hi {{firstName|there}}', vars)).toBe('Hi Ada');
  });

  it('escapes values for HTML but not for plain text', () => {
    const risky = buildMergeVars({ firstName: '<b>"x"</b>', email: 'a@b.co' }, '');
    expect(applyMergeTags('{{firstName}}', risky)).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(applyMergeTags('{{firstName}}', risky, { escape: false })).toBe('<b>"x"</b>');
  });

  it('leaves unknown tags untouched', () => {
    expect(applyMergeTags('{{nope}}', vars)).toBe('{{nope}}');
  });
});

describe('unsubscribe tokens', () => {
  it('verifies a genuine token regardless of email case', () => {
    expect(verifyEmailToken('Ada@X.com', signEmail('ada@x.com'))).toBe(true);
  });

  it('rejects tampered tokens, other emails and missing values', () => {
    const token = signEmail('ada@x.com');
    expect(verifyEmailToken('bob@x.com', token)).toBe(false);
    expect(verifyEmailToken('ada@x.com', `${token}x`)).toBe(false);
    expect(verifyEmailToken('ada@x.com', '')).toBe(false);
    expect(verifyEmailToken('', token)).toBe(false);
  });

  it('round-trips through the URL parameters', () => {
    const url = new URL(buildUnsubscribeUrl('Ada@X.com'));
    expect(url.origin).toBe('https://api.example.test');
    const email = decodeEmailParam(url.searchParams.get('e'));
    expect(email).toBe('ada@x.com');
    expect(verifyEmailToken(email, url.searchParams.get('t'))).toBe(true);
  });
});

describe('renderCampaignEmail', () => {
  const campaign = { subject: 'Hi {{firstName|friend}}', preheader: 'Quick note', bodyHtml: '<p>Hello {{firstName}}</p>' };

  it('personalises subject and body and appends an unsubscribe footer', () => {
    const out = renderCampaignEmail(campaign, { email: 'ada@x.com', firstName: 'Ada', lastName: 'O' });
    expect(out.subject).toBe('Hi Ada');
    expect(out.html).toContain('Hello Ada');
    expect(out.html).toContain(out.unsubscribeUrl);
    expect(out.text).toContain('Hello Ada');
    expect(out.text).toContain(out.unsubscribeUrl);
  });

  it('cannot inject markup or extra headers through a user name', () => {
    const out = renderCampaignEmail(campaign, { email: 'a@b.co', firstName: '<script>x</script>\r\nBcc: z@z.com' });
    expect(out.html).not.toContain('<script>');
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});

describe('htmlToText', () => {
  it('turns links and paragraphs into readable text', () => {
    expect(htmlToText('<p>Hi</p><p>See <a href="https://h.net">our site</a></p>')).toBe('Hi\n\nSee our site (https://h.net)');
  });
});

describe('normalizeAudience', () => {
  it('drops invalid ids and unknown presets', () => {
    const a = normalizeAudience({
      filters: { signup: { preset: 'bogus' }, liveClassIds: [UUID, 'nope', "'; DROP TABLE x;--"], purchased: 'maybe' },
      userIds: [1, '2', -3, 'x', 1.5],
      excludeUserIds: ['7']
    });
    expect(a.filters.signup.preset).toBeNull();
    expect(a.filters.liveClassIds).toEqual([UUID]);
    expect(a.filters.purchased).toBeNull();
    expect(a.userIds).toEqual([1, 2]);
    expect(a.excludeUserIds).toEqual([7]);
  });

  it('defaults to filters mode', () => {
    expect(normalizeAudience({}).mode).toBe('filters');
    expect(normalizeAudience({ mode: 'selected' }).mode).toBe('selected');
  });
});

describe('resolveSignupRange', () => {
  const now = new Date('2026-10-30T10:00:00Z');

  it('computes last_month on Lagos month boundaries', () => {
    const [from, to] = resolveSignupRange({ preset: 'last_month' }, now);
    expect(from.toISOString()).toBe('2026-08-31T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('computes this_month from the Lagos month start to now', () => {
    const [from, to] = resolveSignupRange({ preset: 'this_month' }, now);
    expect(from.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(to).toEqual(now);
  });

  it('computes rolling windows', () => {
    const [from] = resolveSignupRange({ preset: 'last_7_days' }, now);
    expect(now.getTime() - from.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it('includes the whole end day for custom ranges', () => {
    const [from, to] = resolveSignupRange({ preset: 'custom', from: '2026-10-01', to: '2026-10-07' }, now);
    expect(from.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-07T23:00:00.000Z');
  });

  it('returns null with no preset', () => {
    expect(resolveSignupRange({ preset: null }, now)).toBeNull();
  });
});

describe('buildWhere', () => {
  it('always excludes suppressed addresses, invalid emails and the marketer role', () => {
    const { where } = buildWhere({});
    const sql = where.join(' AND ');
    expect(sql).toContain('email_suppressions');
    expect(sql).toContain('u.email ~ :emailPattern');
    expect(sql).toContain("<> 'email_marketer'");
    expect(sql).toContain("<> 'admin'");
  });

  it('only includes admins when asked', () => {
    expect(buildWhere({ filters: { includeAdmins: true } }).where.join(' ')).not.toContain("<> 'admin'");
  });

  it('matches nobody in selected mode without picks', () => {
    expect(buildWhere({ mode: 'selected', userIds: [] }).where).toContain('FALSE');
  });

  it('restricts to picked users and ignores filters in selected mode', () => {
    const { where, replacements } = buildWhere({ mode: 'selected', userIds: [4, 5], filters: { liveClassIds: [UUID] } });
    expect(where.join(' ')).toContain('u.id IN (:pickedUserIds)');
    expect(where.join(' ')).not.toContain('live_attendees');
    expect(replacements.pickedUserIds).toEqual([4, 5]);
  });

  it('adds attendance, series and exclusion clauses with bound parameters only', () => {
    const { where, replacements } = buildWhere({
      filters: { liveClassIds: [UUID], liveSeriesIds: [UUID], purchased: 'no', signup: { preset: 'last_30_days' } },
      excludeUserIds: [9]
    });
    const sql = where.join(' ');
    expect(sql).toContain('live_attendees');
    expect(sql).toContain('live_series_registrations');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM purchases p2');
    expect(sql).toContain('u.id NOT IN (:excludedUserIds)');
    expect(sql).not.toContain(UUID);
    expect(replacements.liveClassIds).toEqual([UUID]);
    expect(replacements.excludedUserIds).toEqual([9]);
    expect(replacements.signupFrom).toBeInstanceOf(Date);
  });
});

describe('classifyError', () => {
  it('pauses on rate limits and outages, fails permanently on 5xx, retries 4xx', () => {
    expect(classifyError({ responseCode: 550, response: '550 Hourly sending limit exceeded', message: 'x' })).toBe('rate_limit');
    expect(classifyError({ code: 'ETIMEDOUT', message: 'timeout' })).toBe('outage');
    expect(classifyError({ code: 'EAUTH', message: 'bad login' })).toBe('outage');
    expect(classifyError({ responseCode: 550, response: '550 No such user', message: 'x' })).toBe('permanent');
    expect(classifyError({ code: 'EENVELOPE', message: 'bad address' })).toBe('permanent');
    expect(classifyError({ responseCode: 451, response: '451 Try again', message: 'x' })).toBe('transient');
  });
});
