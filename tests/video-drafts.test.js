/**
 * Video drafts: the upload starts when the file is picked; the video stays a
 * private draft until Publish. Database, Video model and Mux are mocked.
 */
process.env.CLIENT_URL = 'https://hallos.net';

const OWNER = 7;
const mockVideos = new Map();
const mockDrafts = new Set();
const mockMux = {
  created: [],
  cancelled: [],
  deletedAssets: [],
};
let mockReady = true;
let mockNextId = 0;

const mockVideoRow = (data) => {
  const row = {
    ...data,
    update: jest.fn(async (changes) => Object.assign(row, changes)),
    destroy: jest.fn(async () => mockVideos.delete(row.id)),
  };
  return row;
};

jest.mock('../config/db', () => ({
  query: jest.fn(async (sql, { replacements: r = {} } = {}) => {
    const s = sql.trim();
    if (s.startsWith('SELECT 1 FROM video_drafts')) return [mockDrafts.has(r.videoId) ? [{ '?column?': 1 }] : []];
    if (s.startsWith('INSERT INTO video_drafts')) { mockDrafts.add(r.videoId); return [[]]; }
    if (s.startsWith('DELETE FROM video_drafts')) { mockDrafts.delete(r.videoId); return [[]]; }
    if (s.startsWith('SELECT video_id FROM video_drafts')) return [[...mockDrafts].map((video_id) => ({ video_id }))];
    return [[]];
  }),
  transaction: jest.fn(async (fn) => fn({})),
}));
jest.mock('../utils/ensureVideoDrafts', () => ({ isVideoDraftsReady: () => mockReady }));
jest.mock('../config/mux', () => ({
  video: {
    uploads: {
      create: jest.fn(async (opts) => {
        const upload = { id: `up${mockMux.created.length + 1}`, url: `https://storage.mux.test/${mockMux.created.length + 1}`, opts };
        mockMux.created.push(upload);
        return upload;
      }),
      cancel: jest.fn(async (id) => { mockMux.cancelled.push(id); }),
    },
    assets: { delete: jest.fn(async (id) => { mockMux.deletedAssets.push(id); }) },
  },
}));
jest.mock('../models/Video', () => ({
  create: jest.fn(async (data) => {
    mockNextId += 1;
    const id = `0b6c7c5e-1111-4222-8333-${String(mockNextId).padStart(12, '0')}`;
    const row = mockVideoRow({ id, ...data });
    mockVideos.set(id, row);
    return row;
  }),
  findByPk: jest.fn(async (id) => mockVideos.get(id) || null),
}));

const drafts = require('../services/videoDraftService');

beforeEach(() => {
  mockVideos.clear();
  mockDrafts.clear();
  mockMux.created.length = 0;
  mockMux.cancelled.length = 0;
  mockMux.deletedAssets.length = 0;
  mockReady = true;
});

const GB = 1024 * 1024 * 1024;

describe('starting an upload', () => {
  test('makes a private draft titled from the file name, with a long-lived upload link for our site only', async () => {
    const out = await drafts.createDraft({
      userId: OWNER,
      fileName: 'My_Holiday Clip.mp4',
      sizeBytes: 1.5 * GB,
      type: 'long',
      durationSeconds: 754.4,
      origin: 'https://www.hallos.net',
    });
    const video = mockVideos.get(out.videoId);
    expect(out.uploadUrl).toBe('https://storage.mux.test/1');
    expect(out.title).toBe('My Holiday Clip');
    expect(video).toMatchObject({ privacy: 'private', status: 'uploading', muxUploadId: 'up1', durationSeconds: 754, sizeBytes: 1.5 * GB });
    expect(mockDrafts.has(out.videoId)).toBe(true);
    expect(mockMux.created[0].opts).toMatchObject({ cors_origin: 'https://www.hallos.net', timeout: 24 * 60 * 60 });
  });

  test('other sites get our own address as the allowed origin', () => {
    expect(drafts.uploadOrigin('https://evil.example')).toBe('https://hallos.net');
    expect(drafts.uploadOrigin(undefined)).toBe('https://hallos.net');
  });

  test('refuses files over 5 GB and empty files, before asking Mux for anything', async () => {
    await expect(drafts.createDraft({ userId: OWNER, fileName: 'big.mov', sizeBytes: 5 * GB + 1 })).rejects.toMatchObject({ status: 413, code: 'TOO_LARGE' });
    await expect(drafts.createDraft({ userId: OWNER, fileName: 'empty.mp4', sizeBytes: 0 })).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    expect(mockMux.created).toHaveLength(0);
  });

  test('says "not available" (so the site uses the classic flow) while drafts are not set up', async () => {
    mockReady = false;
    await expect(drafts.createDraft({ userId: OWNER, fileName: 'a.mp4', sizeBytes: 10 })).rejects.toMatchObject({ status: 503, code: 'DRAFTS_UNAVAILABLE' });
  });

  test('never leaves half a draft behind if saving fails', async () => {
    const Video = require('../models/Video');
    Video.create.mockImplementationOnce(async () => { throw new Error('db down'); });
    await expect(drafts.createDraft({ userId: OWNER, fileName: 'a.mp4', sizeBytes: 10 })).rejects.toThrow('db down');
    expect(mockMux.cancelled).toEqual(['up1']);
    expect(mockVideos.size).toBe(0);
  });
});

describe('publishing', () => {
  const start = () => drafts.createDraft({ userId: OWNER, fileName: 'clip.mp4', sizeBytes: 100 });

  test('saves the details, makes it public and clears the draft mark (even while still uploading)', async () => {
    const { videoId } = await start();
    await drafts.publish({
      userId: OWNER,
      videoId,
      body: { title: '  Intro to Figma ', description: 'Basics', price: '2500', currency: 'ngn', type: 'long', category: 'design', tags: 'figma, ui', privacy: 'public', restriction: 'false' },
      thumbnailFile: { location: 'https://cdn.example/t.jpg' },
    });
    expect(mockVideos.get(videoId)).toMatchObject({
      title: 'Intro to Figma',
      price: 2500,
      currency: 'NGN',
      tags: ['figma', 'ui'],
      privacy: 'public',
      ageRestriction: false,
      thumbnailUrl: 'https://cdn.example/t.jpg',
      status: 'uploading',
    });
    expect(mockDrafts.has(videoId)).toBe(false);
  });

  test('needs a title and a valid price; unknown privacy falls back to public', async () => {
    const { videoId } = await start();
    await expect(drafts.publish({ userId: OWNER, videoId, body: { title: '  ' } })).rejects.toMatchObject({ code: 'TITLE_REQUIRED' });
    await expect(drafts.publish({ userId: OWNER, videoId, body: { title: 'x', price: '-5' } })).rejects.toMatchObject({ code: 'INVALID_PRICE' });
    await drafts.publish({ userId: OWNER, videoId, body: { title: 'x', privacy: 'everyone' } });
    expect(mockVideos.get(videoId).privacy).toBe('public');
  });

  test('only the owner, only drafts', async () => {
    const { videoId } = await start();
    await expect(drafts.publish({ userId: 99, videoId, body: { title: 'x' } })).rejects.toMatchObject({ status: 404 });
    await drafts.publish({ userId: OWNER, videoId, body: { title: 'x' } });
    await expect(drafts.publish({ userId: OWNER, videoId, body: { title: 'y' } })).rejects.toMatchObject({ status: 409, code: 'NOT_A_DRAFT' });
    await expect(drafts.publish({ userId: OWNER, videoId: 'not-a-uuid', body: { title: 'y' } })).rejects.toMatchObject({ status: 404 });
  });
});

describe('discarding and restarting', () => {
  test('discard stops the Mux upload and removes the draft', async () => {
    const { videoId } = await drafts.createDraft({ userId: OWNER, fileName: 'clip.mp4', sizeBytes: 100 });
    mockVideos.get(videoId).muxAssetId = 'asset1';
    await drafts.discard({ userId: OWNER, videoId });
    expect(mockMux.cancelled).toContain('up1');
    expect(mockMux.deletedAssets).toEqual(['asset1']);
    expect(mockVideos.has(videoId)).toBe(false);
    expect(mockDrafts.has(videoId)).toBe(false);
  });

  test('a published video can’t be discarded through drafts', async () => {
    const { videoId } = await drafts.createDraft({ userId: OWNER, fileName: 'clip.mp4', sizeBytes: 100 });
    await drafts.publish({ userId: OWNER, videoId, body: { title: 'x' } });
    await expect(drafts.discard({ userId: OWNER, videoId })).rejects.toMatchObject({ code: 'NOT_A_DRAFT' });
    expect(mockVideos.has(videoId)).toBe(true);
  });

  test('restart gives an unfinished upload a fresh link and cancels the old one', async () => {
    const { videoId } = await drafts.createDraft({ userId: OWNER, fileName: 'clip.mp4', sizeBytes: 100 });
    mockVideos.get(videoId).status = 'failed';
    const out = await drafts.restartUpload({ userId: OWNER, videoId });
    expect(out.uploadUrl).toBe('https://storage.mux.test/2');
    expect(mockVideos.get(videoId)).toMatchObject({ muxUploadId: 'up2', status: 'uploading' });
    expect(mockMux.cancelled).toEqual(['up1']);
  });

  test('restart refuses once the file is already uploaded', async () => {
    const { videoId } = await drafts.createDraft({ userId: OWNER, fileName: 'clip.mp4', sizeBytes: 100 });
    mockVideos.get(videoId).status = 'processing';
    await expect(drafts.restartUpload({ userId: OWNER, videoId })).rejects.toMatchObject({ code: 'ALREADY_UPLOADED' });
  });
});

test('draft ids for the creator’s own list', async () => {
  const { videoId } = await drafts.createDraft({ userId: OWNER, fileName: 'clip.mp4', sizeBytes: 100 });
  expect((await drafts.draftIdsOf(OWNER)).has(videoId)).toBe(true);
  mockReady = false;
  expect((await drafts.draftIdsOf(OWNER)).size).toBe(0);
});

test('titles from file names', () => {
  expect(drafts.titleFromFileName('lesson_01_final.MOV')).toBe('lesson 01 final');
  expect(drafts.titleFromFileName('.mp4')).toBe('Untitled video');
  expect(drafts.titleFromFileName('a'.repeat(300) + '.mp4')).toHaveLength(100);
});
