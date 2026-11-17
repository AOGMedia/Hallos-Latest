const investors = require('../services/investorRelationsService');

/**
 * Admin: profiles on the investor relations page. Every change is logged by the
 * staff action log (non-GET requests), like other admin edits.
 */
const handle = (fn, what) => async (req, res) => {
  try {
    const data = await fn(req, res);
    return res.status(req.method === 'POST' ? 201 : 200).json({ success: true, data });
  } catch (error) {
    if (error instanceof investors.InvestorError) {
      return res.status(error.status).json({ success: false, message: error.message, field: error.field });
    }
    console.error(`[Admin Investors] ${what} failed:`, error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.list = handle(() => investors.listAll(), 'Listing profiles');
exports.create = handle((req) => investors.create(req.body, req.user), 'Adding a profile');
exports.update = handle((req) => investors.update(req.params.id, req.body, req.user), 'Saving a profile');
exports.remove = handle(async (req) => {
  await investors.remove(req.params.id);
  return { deleted: true };
}, 'Deleting a profile');
exports.reorder = handle((req) => investors.reorder(req.body?.ids, req.user), 'Reordering profiles');

/** A profile photo: checked from its bytes (not its name), stored with other uploads. */
exports.uploadPhoto = async (req, res) => {
  try {
    const storage = require('../services/s3Service');
    if (!storage.isStorageConfigured()) {
      return res.status(503).json({ success: false, message: 'Image storage isn’t set up on the server. Use a photo address instead.' });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose a photo to upload.' });
    const { sniffImageType } = require('../services/liveChatMediaService');
    const type = sniffImageType(req.file.buffer);
    if (!type || type.ext === '.gif') return res.status(400).json({ success: false, message: 'Use a JPEG, PNG or WebP photo.' });
    const { url } = await storage.uploadFileToS3(req.file.buffer, `investor${type.ext}`, type.mime, 'investor-photos');
    return res.status(201).json({ success: true, data: { url } });
  } catch (error) {
    console.error('[Admin Investors] Photo upload failed:', error.message);
    return res.status(500).json({ success: false, message: 'The photo couldn’t be uploaded. Please try again.' });
  }
};
