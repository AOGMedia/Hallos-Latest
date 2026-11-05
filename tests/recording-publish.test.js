/**
 * Publishing GetStream recordings as videos: validation, duplicate protection,
 * Mux import and webhook handling. Models and Mux are mocked — needs no
 * database or real credentials.
 */

const mockVideos = new Map();
const mockPublications = [];
let mockNextId = 1;
const uuid = () => `00000000-0000-4000-8000-${String(mockNextId++).padStart(12, '0')}`;

function mockVideoRow(fields) {
  const row = {
    ...fields,
    update: jest.fn(async (changes) => Object.assign(row, changes)),
    destroy: jest.fn(async () => mockVideos.delete(row.id)),
    reload: jest.fn(async () => row),
    toJSON: () => ({ id: row.id, title: row.title, status: row.status, price: row.price, currency: row.currency })
  };
  return row;
}

jest.mock('../models/Video', () => ({
  create: jest.fn(async (fields) => {
    const row = mockVideoRow({ id: uuid(), ...fields });
    mockVideos.set(row.id, row);
    return row;
  }),
  findByPk: jest.fn(async (id) => mockVideos.get(id) || null),
  findAll: jest.fn(async ({ where }) => where.id.map((id) => mockVideos.get(id)).filter(Boolean)),
  update: jest.fn(async (changes, { where }) => {
    const row = mockVideos.get(where.id);
    if (row && row.status !== 'ready') Object.assign(row, changes);
    return [row ? 1 : 0];
  })
}));

jest.mock('../models/RecordingPublication', () => {
  const matches = (p, where) => Object.entries(where).every(([k, v]) => p[k] === v);
  return {
    findOne: jest.fn(async ({ where }) => {
      const p = mockPublications.find((x) => matches(x, where));
      return p ? { ...p, destroy: async () => mockPublications.splice(mockPublications.indexOf(p), 1) } : null;
    }),
    findAll: jest.fn(async ({ where }) => mockPublications.filter((x) => matches(x, where))),
    create: jest.fn(async (fields) => {
      mockPublications.push({ ...fields });
      return fields;
    }),
    destroy: jest.fn(async ({ where }) => {
      const i = mockPublications.findIndex((x) => matches(x, where));
      if (i >= 0) mockPublications.splice(i, 1);
    })
  };
});

const mockAssetsCreate = jest.fn(async () => ({ id: 'asset-1' }));
const mockAssetsRetrieve = jest.fn();
jest.mock('../config/mux', () => ({
  video: { assets: { create: (...a) => mockAssetsCreate(...a), retrieve: (...a) => mockAssetsRetrieve(...a) } }
}));

const service = require('../services/recordingPublishService');
const { GetStreamError } = require('../services/getStreamService');

const SOURCE_ID = '0b6c7c5e-1111-4222-8333-944455556666';
const recordings = [{ filename: 'rec-1.mp4', url: 'https://getstream/rec-1.mp4', session: 1 }];
const body = { filename: 'rec-1.mp4', title: 'Branding — Session 1', price: '5000', currency: 'NGN', tags: 'brand, marketing' };
const publish = (overrides = {}) =>
  service.publishRecording({ sourceType: 'session', sourceId: SOURCE_ID, recordings, userId: 847, body, ...overrides });

beforeEach(() => {
  mockVideos.clear();
  mockPublications.length = 0;
  jest.clearAllMocks();
  mockAssetsCreate.mockImplementation(async () => ({ id: 'asset-1' }));
});

describe('parseDetails', () => {
  test('normalises price, currency, privacy and tags', () => {
    expect(service.parseDetails(body)).toEqual({
      title: 'Branding — Session 1',
      description: null,
      price: 5000,
      currency: 'NGN',
      privacy: 'public',
      category: null,
      tags: ['brand', 'marketing']
    });
  });

  test.each([
    [{ title: '' }, /title/],
    [{ title: 'x', price: -1 }, /price/],
    [{ title: 'x', price: 'abc' }, /price/],
    [{ title: 'x', currency: 'EUR' }, /Currency/],
    [{ title: 'x', privacy: 'secret' }, /Privacy/]
  ])('rejects %o', (input, message) => {
    expect(() => service.parseDetails(input)).toThrow(message);
  });
});

describe('publishRecording', () => {
  test('creates a video and imports the recording into Mux', async () => {
    const result = await publish();
    expect(result.alreadyPublished).toBe(false);

    const video = mockVideos.get(result.video.id);
    expect(video).toMatchObject({ userId: 847, type: 'long', status: 'uploading', muxAssetId: 'asset-1', price: 5000 });
    expect(mockAssetsCreate).toHaveBeenCalledWith({
      inputs: [{ url: 'https://getstream/rec-1.mp4' }],
      playback_policies: ['public'],
      passthrough: `${service.PASSTHROUGH_PREFIX}${video.id}`
    });
    expect(mockPublications).toHaveLength(1);
  });

  test('publishing the same recording again returns the first video', async () => {
    const first = await publish();
    const second = await publish();
    expect(second.alreadyPublished).toBe(true);
    expect(second.video.id).toBe(first.video.id);
    expect(mockAssetsCreate).toHaveBeenCalledTimes(1);
  });

  test('a failed import can be published again', async () => {
    const first = await publish();
    mockVideos.get(first.video.id).status = 'failed';
    const second = await publish();
    expect(second.alreadyPublished).toBe(false);
    expect(second.video.id).not.toBe(first.video.id);
    expect(mockVideos.has(first.video.id)).toBe(false);
  });

  test('cleans up when Mux refuses the import', async () => {
    mockAssetsCreate.mockRejectedValueOnce(new Error('mux down'));
    await expect(publish()).rejects.toBeInstanceOf(GetStreamError);
    expect(mockVideos.size).toBe(0);
    expect(mockPublications).toHaveLength(0);
  });

  test('unknown recording is a 404 and creates nothing', async () => {
    await expect(publish({ body: { ...body, filename: 'nope.mp4' } })).rejects.toMatchObject({ status: 404 });
    expect(mockVideos.size).toBe(0);
  });
});

describe('Mux webhook events', () => {
  test('ready marks the video ready with playback id and a thumbnail', async () => {
    const { video } = await publish();
    const handled = await service.handleMuxAssetEvent('video.asset.ready', {
      id: 'asset-1',
      passthrough: `${service.PASSTHROUGH_PREFIX}${video.id}`,
      playback_ids: [{ id: 'pb-1' }],
      duration: 3600.4
    });
    expect(handled).toBe(true);
    expect(mockVideos.get(video.id)).toMatchObject({
      status: 'ready',
      muxPlaybackId: 'pb-1',
      durationSeconds: 3600,
      thumbnailUrl: 'https://image.mux.com/pb-1/thumbnail.jpg?time=15'
    });
  });

  test('errored marks the video failed', async () => {
    const { video } = await publish();
    await service.handleMuxAssetEvent('video.asset.errored', {
      id: 'asset-1',
      passthrough: `${service.PASSTHROUGH_PREFIX}${video.id}`
    });
    expect(mockVideos.get(video.id).status).toBe('failed');
  });

  test.each([
    ['normal upload', { id: 'a', upload_id: 'u1', passthrough: `${service.PASSTHROUGH_PREFIX}x` }],
    ['live stream', { id: 'a', live_stream_id: 'ls1' }],
    ['other passthrough', { id: 'a', passthrough: 'something-else' }],
    ['no passthrough', { id: 'a' }]
  ])('ignores %s events', async (_name, data) => {
    expect(await service.handleMuxAssetEvent('video.asset.ready', data)).toBe(false);
  });
});

describe('withPublications', () => {
  test('marks each recording with its publication, null when unpublished', async () => {
    const { video } = await publish();
    const list = await service.withPublications('session', SOURCE_ID, [
      ...recordings,
      { filename: 'rec-2.mp4', url: 'https://getstream/rec-2.mp4' }
    ]);
    expect(list[0].publication).toMatchObject({ videoId: video.id });
    expect(list[1].publication).toBeNull();
  });

  test('re-checks importing videos with Mux in case a webhook was missed', async () => {
    const { video } = await publish();
    mockAssetsRetrieve.mockResolvedValueOnce({ id: 'asset-1', status: 'ready', playback_ids: [{ id: 'pb-2' }], duration: 10 });
    const list = await service.withPublications('session', SOURCE_ID, recordings);
    expect(list[0].publication.status).toBe('ready');
    expect(mockVideos.get(video.id).muxPlaybackId).toBe('pb-2');
  });

  test('returns the recordings unchanged when anything fails', async () => {
    require('../models/RecordingPublication').findAll.mockRejectedValueOnce(new Error('db down'));
    expect(await service.withPublications('session', SOURCE_ID, recordings)).toEqual(recordings);
  });
});
