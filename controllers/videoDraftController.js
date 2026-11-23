const drafts = require('../services/videoDraftService');

/**
 * Video drafts: the upload starts when the file is picked (see
 * services/videoDraftService.js). Mounted under /videos/drafts.
 */

const handle = (action, fallback) => async (req, res) => {
  try {
    const data = await action(req);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof drafts.DraftError) {
      return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    }
    console.error(`[Video drafts] ${fallback} (user ${req.user && req.user.id}):`, error.message);
    return res.status(500).json({ success: false, message: fallback });
  }
};

/** POST /videos/drafts  { fileName, sizeBytes, type?, durationSeconds? } */
exports.create = handle(
  (req) =>
    drafts.createDraft({
      userId: req.user.id,
      fileName: req.body && req.body.fileName,
      sizeBytes: req.body && req.body.sizeBytes,
      type: req.body && req.body.type,
      durationSeconds: req.body && req.body.durationSeconds,
      origin: req.get('origin'),
    }),
  'We couldn’t start your upload. Please try again.'
);

/** POST /videos/drafts/:id/restart  A fresh upload link for an unfinished upload. */
exports.restart = handle(
  (req) =>
    drafts.restartUpload({
      userId: req.user.id,
      videoId: req.params.id,
      origin: req.get('origin'),
      fresh: Boolean(req.body && req.body.fresh === true),
    }),
  'We couldn’t restart your upload. Please try again.'
);

/** PUT /videos/drafts/:id/publish  (multipart: details + optional thumbnail) */
exports.publish = handle(async (req) => {
  const thumbnailFile = req.files?.thumbnail?.[0] || req.files?.image?.[0] || null;
  const video = await drafts.publish({ userId: req.user.id, videoId: req.params.id, body: req.body || {}, thumbnailFile });
  return { video: { id: video.id, title: video.title, status: video.status, thumbnailUrl: video.thumbnailUrl } };
}, 'We couldn’t publish your video. Please try again.');

/** DELETE /videos/drafts/:id  Cancel the upload and remove the draft. */
exports.discard = handle(
  (req) => drafts.discard({ userId: req.user.id, videoId: req.params.id }),
  'We couldn’t remove this upload. Please try again.'
);
