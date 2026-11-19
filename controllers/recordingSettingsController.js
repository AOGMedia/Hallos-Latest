const recordingSettingsService = require('../services/recordingSettingsService');

/**
 * The signed-in creator's own recording settings for GetStream classes.
 * Mounted under /live/getstream (routes/getStreamRoutes.js).
 *
 * Everyone edits only their own settings, and they only take effect on
 * classes and series sessions they create — recording itself stays
 * creator-only (enforced by the recording endpoints).
 */

/** GET /live/getstream/recording-settings */
exports.get = async (req, res) => {
  try {
    const { settings, saved } = await recordingSettingsService.getForUser(req.user.id);
    return res.json({
      success: true,
      data: { settings, saved, defaults: recordingSettingsService.DEFAULTS, choices: recordingSettingsService.CHOICES }
    });
  } catch (error) {
    console.error('[Recording settings] Load failed:', error.message);
    return res.status(500).json({ success: false, message: "We couldn't load your recording settings." });
  }
};

/** PUT /live/getstream/recording-settings  { settings } */
exports.save = async (req, res) => {
  try {
    const settings = await recordingSettingsService.saveForUser(req.user.id, req.body && req.body.settings);
    return res.json({ success: true, data: { settings, saved: true } });
  } catch (error) {
    if (error.status === 400 || error.status === 503) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Recording settings] Save failed:', error.message);
    return res.status(500).json({ success: false, message: "We couldn't save your recording settings." });
  }
};

/** DELETE /live/getstream/recording-settings — back to the standard settings. */
exports.reset = async (req, res) => {
  try {
    const settings = await recordingSettingsService.resetForUser(req.user.id);
    return res.json({ success: true, data: { settings, saved: false } });
  } catch (error) {
    console.error('[Recording settings] Reset failed:', error.message);
    return res.status(500).json({ success: false, message: "We couldn't reset your recording settings." });
  }
};
