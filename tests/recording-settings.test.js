/**
 * GetStream recording settings: validation, how they map to GetStream's
 * recording options, and that recording never breaks because of them
 * (standard settings when none are saved or GetStream refuses them).
 * Database and GetStream SDK are mocked.
 */
process.env.STREAM_API_KEY = 'test-key';
process.env.STREAM_API_SECRET = 'test-secret';
process.env.CLIENT_URL = 'https://hallos.net';

const mockPrefs = new Map();
let mockTableReady = true;

jest.mock('../config/db', () => ({
  query: jest.fn(async (sql, { replacements } = {}) => {
    if (/^SELECT settings/.test(sql)) {
      const row = mockPrefs.get(replacements.userId);
      return [row ? [{ settings: row }] : []];
    }
    if (/^INSERT INTO recording_preferences/.test(sql.trim())) {
      mockPrefs.set(replacements.userId, JSON.parse(replacements.settings));
      return [[]];
    }
    if (/^DELETE FROM recording_preferences/.test(sql)) {
      mockPrefs.delete(replacements.userId);
      return [[]];
    }
    return [[]];
  })
}));
jest.mock('../utils/ensureRecordingPreferences', () => ({
  isRecordingPreferencesReady: () => mockTableReady
}));
jest.mock('../services/liveChatMediaService', () => ({ deleteChatMedia: jest.fn().mockResolvedValue(0) }));

const mockCalls = new Map();
function mockCall(id) {
  if (!mockCalls.has(id)) {
    mockCalls.set(id, {
      getOrCreate: jest.fn(async () => ({ call: { id, ended_at: null } })),
      update: jest.fn().mockResolvedValue({}),
      startRecording: jest.fn().mockResolvedValue({}),
      stopRecording: jest.fn().mockResolvedValue({}),
      updateCallMembers: jest.fn().mockResolvedValue({}),
      end: jest.fn().mockResolvedValue({})
    });
  }
  return mockCalls.get(id);
}
jest.mock('@stream-io/node-sdk', () => ({
  StreamClient: jest.fn().mockImplementation(() => ({
    upsertUsers: jest.fn().mockResolvedValue({}),
    generateCallToken: jest.fn(() => 'token'),
    video: { call: (_type, id) => mockCall(id) }
  }))
}));

const service = require('../services/recordingSettingsService');
const { getStreamService } = require('../services/getStreamService');

const CREATOR = { id: 7, firstname: 'Ada', lastname: 'Host' };
const CLASS_ID = '0b6c7c5e-1111-4222-8333-944455556666';
const fakeClass = (overrides = {}) => {
  const lc = {
    id: CLASS_ID,
    userId: CREATOR.id,
    title: 'Intro to Figma',
    status: 'live',
    getstream_call_id: CLASS_ID,
    max_participants: 50,
    update: jest.fn(async (fields) => Object.assign(lc, fields)),
    ...overrides
  };
  return lc;
};

beforeEach(() => {
  mockPrefs.clear();
  mockCalls.clear();
  mockTableReady = true;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('validation', () => {
  test('fills in defaults and keeps valid choices', () => {
    const s = service.sanitize({ quality: '1080p', layout: 'grid', gridSize: '9', showTitle: true, junk: 'x' });
    expect(s).toMatchObject({ quality: '1080p', layout: 'grid', gridSize: 9, showTitle: true, format: 'video' });
    expect(s.junk).toBeUndefined();
  });

  test.each([
    [{ quality: '1440p' }], // not offered: costs more
    [{ quality: '4k' }],
    [{ layout: 'custom' }], // custom layout apps not allowed
    [{ background: '#ff0000' }], // only brand presets
    [{ gridSize: 30 }],
    [{ autoRecord: 'yes' }],
    [null]
  ])('refuses %j', (input) => {
    expect(() => service.sanitize(input)).toThrow(service.RecordingSettingsError);
  });
});

describe('mapping to GetStream', () => {
  test('defaults: 720p spotlight with brand background, names and the Hallos logo', () => {
    const r = service.toStreamRecording(service.DEFAULTS, { title: 'Intro' });
    expect(r).toMatchObject({ mode: 'available', audio_only: false, quality: '720p', layout: { name: 'spotlight' } });
    expect(r.layout.options).toMatchObject({
      'layout.background_color': '#0d0f18',
      'participant_label.display': true,
      'logo.image_url': 'https://hallos.net/transparentlogo.svg',
      'layout.spotlight.participants_bar_position': 'bottom'
    });
    expect(r.layout.options['title.text']).toBeUndefined();
  });

  test('portrait uses GetStream portrait resolutions', () => {
    const s = service.sanitize({ quality: '1080p', orientation: 'portrait' });
    expect(service.toStreamRecording(s).quality).toBe('portrait-1080x1920');
  });

  test('audio only records an MP3: no layout or quality', () => {
    expect(service.toStreamRecording(service.sanitize({ format: 'audio' }), { mode: 'auto-on' })).toEqual({
      mode: 'auto-on',
      audio_only: true
    });
  });

  test('grid and single-speaker options; title is cleaned and shortened', () => {
    const grid = service.toStreamRecording(service.sanitize({ layout: 'grid', gridSize: 4, gridFill: true, showTitle: true }), {
      title: 'A\u0000very   long title '.repeat(10)
    });
    expect(grid.layout.options).toMatchObject({ 'layout.grid.page_size': 4, 'layout.grid.expand_tiles': true });
    expect(grid.layout.options['title.text'].length).toBeLessThanOrEqual(80);
    expect(grid.layout.options['title.text']).not.toMatch(/[\u0000]|\s{2}/);

    const single = service.toStreamRecording(service.sanitize({ layout: 'single-participant', speakerMode: 'rotate' }));
    expect(single.layout.options).toMatchObject({
      'layout.single-participant.mode': 'shuffle',
      'layout.single-participant.shuffle_delay': 10
    });
  });

  test('no logo when the site address is not https', () => {
    process.env.CLIENT_URL = 'http://localhost:3000';
    expect(service.toStreamRecording(service.DEFAULTS).layout.options['logo.image_url']).toBeUndefined();
    process.env.CLIENT_URL = 'https://hallos.net';
  });
});

describe('saving', () => {
  test('save, read back, reset', async () => {
    expect(await service.getForUser(7)).toEqual({ settings: service.DEFAULTS, saved: false });
    await service.saveForUser(7, { quality: '480p' });
    expect((await service.getForUser(7)).settings.quality).toBe('480p');
    expect((await service.getForUser(7)).saved).toBe(true);
    await service.resetForUser(7);
    expect((await service.getForUser(7)).saved).toBe(false);
  });

  test('table not ready: reading gives defaults, saving says try later', async () => {
    mockTableReady = false;
    expect((await service.getForUser(7)).saved).toBe(false);
    await expect(service.saveForUser(7, {})).rejects.toMatchObject({ status: 503 });
  });
});

describe('recording with saved settings', () => {
  test('nothing saved: recording starts exactly as before (no settings change)', async () => {
    const result = await getStreamService.setRecording(fakeClass(), 'start');
    const call = mockCall(CLASS_ID);
    expect(call.update).not.toHaveBeenCalled();
    expect(call.startRecording).toHaveBeenCalledWith({ recording_type: 'composite' });
    expect(result).toEqual({ recording: true });
  });

  test('saved settings are applied to the call before recording starts', async () => {
    await service.saveForUser(7, { quality: '1080p', layout: 'grid' });
    const result = await getStreamService.setRecording(fakeClass(), 'start');
    const call = mockCall(CLASS_ID);
    expect(call.update).toHaveBeenCalledWith({
      settings_override: { recording: expect.objectContaining({ mode: 'available', quality: '1080p', layout: expect.objectContaining({ name: 'grid' }) }) }
    });
    expect(call.update.mock.invocationCallOrder[0]).toBeLessThan(call.startRecording.mock.invocationCallOrder[0]);
    expect(result).toEqual({ recording: true, settingsApplied: true });
  });

  test('if GetStream refuses the settings, recording still starts', async () => {
    await service.saveForUser(7, { quality: '1080p' });
    mockCall(CLASS_ID).update.mockRejectedValueOnce(new Error('invalid settings'));
    const result = await getStreamService.setRecording(fakeClass(), 'start');
    expect(mockCall(CLASS_ID).startRecording).toHaveBeenCalled();
    expect(result).toEqual({ recording: true, settingsApplied: false });
  });

  test('stopping never touches settings', async () => {
    await service.saveForUser(7, { quality: '1080p' });
    await getStreamService.setRecording(fakeClass(), 'stop');
    expect(mockCall(CLASS_ID).update).not.toHaveBeenCalled();
    expect(mockCall(CLASS_ID).stopRecording).toHaveBeenCalled();
  });

  test('settings can not be read: recording starts with the standard settings', async () => {
    const db = require('../config/db');
    db.query.mockRejectedValueOnce(new Error('db down'));
    const result = await getStreamService.setRecording(fakeClass(), 'start');
    expect(mockCall(CLASS_ID).update).not.toHaveBeenCalled();
    expect(result).toEqual({ recording: true });
  });
});

describe('auto-record', () => {
  const scheduled = () => fakeClass({ status: 'scheduled', getstream_call_id: null });

  test('without auto-record, new calls get the standard settings (as before)', async () => {
    await service.saveForUser(7, { quality: '1080p' });
    await getStreamService.startSession(scheduled(), CREATOR);
    expect(mockCall(CLASS_ID).getOrCreate.mock.calls[0][0].data.settings_override.recording).toEqual({
      mode: 'available',
      quality: '720p'
    });
  });

  test('with auto-record, the call is created to record by itself with the saved settings', async () => {
    await service.saveForUser(7, { quality: '1080p', autoRecord: true });
    await getStreamService.startSession(scheduled(), CREATOR);
    expect(mockCall(CLASS_ID).getOrCreate.mock.calls[0][0].data.settings_override.recording).toMatchObject({
      mode: 'auto-on',
      quality: '1080p'
    });
  });

  test('if GetStream refuses them, the class still starts with the standard settings', async () => {
    await service.saveForUser(7, { autoRecord: true });
    mockCall(CLASS_ID).getOrCreate.mockRejectedValueOnce(new Error('bad recording settings'));
    const result = await getStreamService.startSession(scheduled(), CREATOR);
    const calls = mockCall(CLASS_ID).getOrCreate.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0].data.settings_override.recording).toEqual({ mode: 'available', quality: '720p' });
    expect(result.callId).toBe(CLASS_ID);
  });

  test('series sessions use the series creator\'s settings', async () => {
    await service.saveForUser(7, { autoRecord: true, format: 'audio' });
    const session = { id: 'sess-1', status: 'scheduled', update: jest.fn(async () => {}) };
    await getStreamService.startSeriesSession(session, { id: 'series-1', userId: 7, title: 'Design Series', maxParticipants: 20 }, CREATOR);
    expect(mockCall('sess-1').getOrCreate.mock.calls[0][0].data.settings_override.recording).toEqual({
      mode: 'auto-on',
      audio_only: true
    });

    const live = { id: 'sess-1', status: 'live', series: { userId: 7, title: 'Design Series' } };
    await getStreamService.setSeriesSessionRecording(live, 'start');
    expect(mockCall('sess-1').update).toHaveBeenCalledWith({
      settings_override: { recording: { mode: 'available', audio_only: true } }
    });
  });
});
