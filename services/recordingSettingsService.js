const sequelize = require('../config/db');
const { isRecordingPreferencesReady } = require('../utils/ensureRecordingPreferences');

/**
 * A creator's recording settings for GetStream classes and series sessions:
 * stored per creator, validated against a fixed list of choices, and turned
 * into GetStream's recording settings (composite recording — one video with
 * everyone in it).
 *
 * Only what GetStream documents is used (docs: video/docs/api/recording/
 * composite). Deliberately left out: 1440p (costs more, rarely needed),
 * custom CSS / custom layout apps (arbitrary URLs; GetStream asks to be
 * involved), and per-person / raw recordings (not one watchable video).
 *
 * Creators who never save settings get exactly the old behaviour: nothing is
 * changed on their calls.
 */

class RecordingSettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecordingSettingsError';
    this.status = 400;
  }
}

/** Every choice the app offers. The frontend mirrors these. */
const CHOICES = {
  format: ['video', 'audio'],
  quality: ['360p', '480p', '720p', '1080p'],
  orientation: ['landscape', 'portrait'],
  layout: ['spotlight', 'grid', 'single-participant'],
  spotlightBar: ['bottom', 'top', 'left', 'right'],
  gridSize: [4, 9, 16, 20],
  speakerMode: ['presenter', 'rotate'],
  background: ['midnight', 'slate', 'brand', 'black'],
  videoFit: ['fill', 'fit']
};
const BOOLEAN_KEYS = ['gridFill', 'showLogo', 'showTitle', 'showNames', 'autoRecord'];

/** What the settings start as (720p, like before). */
const DEFAULTS = Object.freeze({
  format: 'video',
  quality: '720p',
  orientation: 'landscape',
  layout: 'spotlight',
  spotlightBar: 'bottom',
  gridSize: 20,
  gridFill: false,
  speakerMode: 'presenter',
  showLogo: true,
  showTitle: false,
  showNames: true,
  background: 'midnight',
  videoFit: 'fill',
  autoRecord: false
});

/** Brand backgrounds behind the video tiles. */
const BACKGROUND_COLORS = {
  midnight: '#0d0f18',
  slate: '#1f2636',
  brand: '#6a57e5',
  black: '#000000'
};

/** GetStream's portrait resolutions for each quality. */
const PORTRAIT_QUALITY = {
  '360p': 'portrait-360x640',
  '480p': 'portrait-480x854',
  '720p': 'portrait-720x1280',
  '1080p': 'portrait-1080x1920'
};

/**
 * A complete, valid settings object from what the client sent. Unknown keys
 * are dropped; a known key with a value outside its choices is refused.
 */
function sanitize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RecordingSettingsError('Recording settings are missing');
  }
  const settings = { ...DEFAULTS };
  for (const [key, choices] of Object.entries(CHOICES)) {
    if (input[key] === undefined) continue;
    const value = key === 'gridSize' ? Number(input[key]) : input[key];
    if (!choices.includes(value)) {
      throw new RecordingSettingsError(`That ${key} isn't one of the options`);
    }
    settings[key] = value;
  }
  for (const key of BOOLEAN_KEYS) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw new RecordingSettingsError(`${key} must be on or off`);
    settings[key] = input[key];
  }
  return settings;
}

/** Saved settings read back from the database, tolerating older/partial rows. */
function fromStored(stored) {
  try {
    return sanitize(stored || {});
  } catch {
    return { ...DEFAULTS };
  }
}

/** The Hallos logo for recordings: only an absolute https URL (GetStream's renderer loads it). */
function logoUrl() {
  const base = String(process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\//i.test(base) ? `${base}/transparentlogo.svg` : null;
}

/** Plain, short title text (it's drawn onto the recording). */
const cleanTitle = (title) =>
  String(title || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

/**
 * GetStream's `settings_override.recording` for these settings.
 * @param {object} settings - sanitized settings
 * @param {{ title?: string, mode?: 'available'|'auto-on' }} context
 */
function toStreamRecording(settings, { title, mode = 'available' } = {}) {
  if (settings.format === 'audio') {
    return { mode, audio_only: true };
  }

  const quality = settings.orientation === 'portrait' ? PORTRAIT_QUALITY[settings.quality] : settings.quality;
  const background = BACKGROUND_COLORS[settings.background] || BACKGROUND_COLORS.midnight;
  const options = {
    'layout.background_color': background,
    'video.background_color': background,
    'video.scale_mode': settings.videoFit,
    'participant_label.display': settings.showNames
  };

  const logo = settings.showLogo ? logoUrl() : null;
  if (logo) options['logo.image_url'] = logo;

  const text = settings.showTitle ? cleanTitle(title) : '';
  if (text) options['title.text'] = text;

  if (settings.layout === 'spotlight') {
    options['layout.spotlight.participants_bar_position'] = settings.spotlightBar;
  } else if (settings.layout === 'grid') {
    options['layout.grid.page_size'] = settings.gridSize;
    options['layout.grid.expand_tiles'] = settings.gridFill;
  } else if (settings.layout === 'single-participant') {
    options['layout.single-participant.mode'] = settings.speakerMode === 'rotate' ? 'shuffle' : 'default';
    if (settings.speakerMode === 'rotate') options['layout.single-participant.shuffle_delay'] = 10;
  }

  return {
    mode,
    audio_only: false,
    quality,
    layout: { name: settings.layout, options }
  };
}

/** The creator's settings, and whether they've saved any. */
async function getForUser(userId) {
  if (!isRecordingPreferencesReady()) return { settings: { ...DEFAULTS }, saved: false };
  const [rows] = await sequelize.query('SELECT settings FROM recording_preferences WHERE user_id = :userId', {
    replacements: { userId }
  });
  return rows.length ? { settings: fromStored(rows[0].settings), saved: true } : { settings: { ...DEFAULTS }, saved: false };
}

/** Save (or replace) the creator's settings. */
async function saveForUser(userId, input) {
  if (!isRecordingPreferencesReady()) {
    const error = new Error("Recording settings can't be saved right now. Please try again shortly.");
    error.status = 503;
    throw error;
  }
  const settings = sanitize(input);
  await sequelize.query(
    `INSERT INTO recording_preferences (user_id, settings, created_at, updated_at)
     VALUES (:userId, CAST(:settings AS JSONB), NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
    { replacements: { userId, settings: JSON.stringify(settings) } }
  );
  return settings;
}

/** Back to the standard settings (the row is removed: nothing is overridden any more). */
async function resetForUser(userId) {
  if (!isRecordingPreferencesReady()) return { ...DEFAULTS };
  await sequelize.query('DELETE FROM recording_preferences WHERE user_id = :userId', { replacements: { userId } });
  return { ...DEFAULTS };
}

/**
 * The creator's saved settings as a GetStream recording override, or null
 * when they haven't saved any (or they can't be read) — then nothing is
 * changed and recording works exactly as before.
 */
async function savedOverrideFor(creatorId, context) {
  try {
    const { settings, saved } = await getForUser(creatorId);
    if (!saved) return null;
    return { settings, recording: toStreamRecording(settings, context) };
  } catch (error) {
    console.error('[Recording settings] Could not read saved settings; using the standard ones:', error.message);
    return null;
  }
}

module.exports = {
  CHOICES,
  DEFAULTS,
  RecordingSettingsError,
  sanitize,
  toStreamRecording,
  getForUser,
  saveForUser,
  resetForUser,
  savedOverrideFor
};
