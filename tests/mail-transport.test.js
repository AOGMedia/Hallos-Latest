jest.mock('axios');
jest.mock('nodemailer');

const axios = require('axios');
const nodemailer = require('nodemailer');

const ENV_KEYS = ['BREVO_API_KEY', 'MAIL_PROVIDER', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_REPLY_TO', 'EMAIL_USER', 'EMAIL_HOST'];
const savedEnv = {};

const load = () => {
  jest.resetModules();
  jest.doMock('axios', () => axios);
  jest.doMock('nodemailer', () => nodemailer);
  return require('../services/mailTransport');
};

const brevoError = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

beforeEach(() => {
  ENV_KEYS.forEach((key) => {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  });
  axios.post.mockReset();
  axios.get.mockReset();
  nodemailer.createTransport.mockReset();
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

describe('mailTransport provider selection', () => {
  it('uses Brevo when BREVO_API_KEY is set and SMTP otherwise', () => {
    expect(load().provider()).toBe('smtp');
    process.env.BREVO_API_KEY = 'key';
    expect(load().provider()).toBe('brevo');
  });

  it('MAIL_PROVIDER=smtp wins over an API key', () => {
    process.env.BREVO_API_KEY = 'key';
    process.env.MAIL_PROVIDER = 'smtp';
    expect(load().provider()).toBe('smtp');
  });
});

describe('address helpers', () => {
  it('parses plain, named, comma separated and object addresses and drops invalid or duplicate ones', () => {
    const { parseList } = load();
    expect(parseList('a@x.com, "Doe, Jane" <b@x.com>; A@X.com, nope')).toEqual([
      { email: 'a@x.com' },
      { email: 'b@x.com', name: 'Doe, Jane' }
    ]);
    expect(parseList([{ name: 'C', address: 'c@x.com' }])).toEqual([{ email: 'c@x.com', name: 'C' }]);
    expect(parseList(undefined)).toEqual([]);
  });

  it('swaps the legacy EMAIL_USER address for EMAIL_FROM_ADDRESS but respects other explicit addresses', () => {
    process.env.EMAIL_USER = 'support@hallos.net';
    process.env.EMAIL_FROM_ADDRESS = 'hello@hallos.net';
    const { resolveSender } = load();
    expect(resolveSender('"hallos Team" <support@hallos.net>')).toEqual({ email: 'hello@hallos.net', name: 'hallos Team' });
    expect(resolveSender('"Campaigns" <news@hallos.net>')).toEqual({ email: 'news@hallos.net', name: 'Campaigns' });
  });

  it('falls back to EMAIL_FROM_NAME when the caller gives no display name', () => {
    process.env.EMAIL_FROM_ADDRESS = 'hello@hallos.net';
    process.env.EMAIL_FROM_NAME = 'Hallos Support';
    expect(load().resolveSender('x@y.com').name).toBe('Hallos Support');
  });
});

describe('Brevo API sending', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key';
    process.env.EMAIL_USER = 'support@hallos.net';
    process.env.EMAIL_FROM_ADDRESS = 'hello@hallos.net';
  });

  it('posts a Brevo payload with the api-key header and returns a nodemailer-style result', async () => {
    axios.post.mockResolvedValue({ status: 201, data: { messageId: '<abc@smtp-relay.mailin.fr>' } });
    const { sendMail } = load();

    const result = await sendMail({
      from: '"hallos Team" <support@hallos.net>',
      to: 'user@example.com',
      cc: 'cc@example.com',
      replyTo: 'reply@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: { 'list-unsubscribe': '<https://x>', 'X-Entity-Ref-ID': '42' }
    });

    const [url, payload, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(config.headers['api-key']).toBe('test-key');
    expect(payload).toMatchObject({
      sender: { email: 'hello@hallos.net', name: 'hallos Team' },
      to: [{ email: 'user@example.com' }],
      cc: [{ email: 'cc@example.com' }],
      replyTo: { email: 'reply@example.com' },
      subject: 'Hello',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
      headers: { 'List-Unsubscribe': '<https://x>', 'X-Entity-Ref-Id': '42' }
    });
    expect(result).toMatchObject({ messageId: '<abc@smtp-relay.mailin.fr>', accepted: ['user@example.com', 'cc@example.com'], rejected: [] });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('refuses to send with no valid recipient or no body, without calling the API', async () => {
    const { sendMail } = load();
    await expect(sendMail({ from: 'a@b.com', to: 'not-an-email', subject: 's', html: 'x' })).rejects.toMatchObject({ code: 'EENVELOPE' });
    await expect(sendMail({ from: 'a@b.com', to: 'u@x.com', subject: 's' })).rejects.toMatchObject({ code: 'EMESSAGE' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  const send = () => load().sendMail({ from: 'a@b.com', to: 'u@x.com', subject: 's', html: 'x' });

  it.each([
    [401, { code: 'unauthorized', message: 'Key not found' }, 'EAUTH'],
    [403, { message: 'unrecognised IP address' }, 'EAUTH'],
    [429, { message: 'Too many requests' }, 'ERATE'],
    [503, {}, 'EPROVIDER'],
    [400, { message: 'Sending has been rejected because the sender you used x@y.com is not valid' }, 'EAUTH'],
    [400, { message: 'email is not valid in to' }, 'EMESSAGE']
  ])('maps a Brevo %i response to error code %s', async (status, data, code) => {
    axios.post.mockRejectedValue(brevoError(status, data));
    await expect(send()).rejects.toMatchObject({ code, responseCode: status });
  });

  it('reports an unreachable API as a connection error', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' }));
    await expect(send()).rejects.toMatchObject({ code: 'ECONNECTION' });
  });

  it('lets the campaign worker pause for provider problems and fail only bad recipients', async () => {
    const { classifyError } = require('../services/emailCampaignWorker');
    const classify = async (status, data) => {
      axios.post.mockRejectedValue(brevoError(status, data));
      return classifyError(await send().catch((e) => e));
    };
    expect(await classify(401, { message: 'Key not found' })).toBe('outage');
    expect(await classify(503, {})).toBe('outage');
    expect(await classify(429, { message: 'Too many requests' })).toBe('rate_limit');
    expect(await classify(400, { message: 'Daily sending limit reached' })).toBe('rate_limit');
    expect(await classify(400, { message: 'email is not valid in to' })).toBe('permanent');
  });

  it('verify() reads the Brevo account', async () => {
    axios.get.mockResolvedValue({ data: { email: 'owner@hallos.net', plan: [{ type: 'free' }] } });
    await expect(load().verify()).resolves.toMatchObject({ provider: 'brevo', accountEmail: 'owner@hallos.net' });
    expect(axios.get.mock.calls[0][0]).toBe('https://api.brevo.com/v3/account');
  });

  it('describe() never exposes the key', () => {
    const info = load().describe();
    expect(info).toEqual({ provider: 'brevo', host: 'api.brevo.com', from: 'hello@hallos.net', dedicatedProvider: true });
  });
});

describe('SMTP fallback', () => {
  it('sends through nodemailer when no API key is set, with the message untouched', async () => {
    const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'smtp-1' });
    nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });
    const mail = { from: '"hallos Team" <support@hallos.net>', to: 'u@x.com', subject: 's', html: 'x' };

    await expect(load().sendMail(mail)).resolves.toEqual({ messageId: 'smtp-1' });
    expect(sendMailMock).toHaveBeenCalledWith(mail);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('explains the Render SMTP block when the connection times out', async () => {
    nodemailer.createTransport.mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }))
    });
    await expect(load().sendMail({ from: 'a@b.com', to: 'u@x.com', subject: 's', html: 'x' })).rejects.toThrow(/BREVO_API_KEY/);
  });
});
