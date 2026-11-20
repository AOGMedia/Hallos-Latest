const classFeedbackService = require('../services/classFeedbackService');

/**
 * The feedback form behind each personal link (/feedback/<token> on the
 * website). The token is the access: no sign-in step, so it opens straight
 * from an email on any device. Mounted at /api/class-feedback.
 */

const send = (res, error, fallback) => {
  if (error instanceof classFeedbackService.FeedbackError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code });
  }
  console.error(`[Class feedback] ${fallback}:`, error.message);
  return res.status(500).json({ success: false, message: fallback });
};

/** GET /api/class-feedback/:token */
exports.getForm = async (req, res) => {
  try {
    return res.json({ success: true, data: await classFeedbackService.getForm(req.params.token) });
  } catch (error) {
    return send(res, error, 'We couldn’t open this feedback form.');
  }
};

/**
 * POST /api/class-feedback/link  { kind: 'class'|'session', id }  (signed in)
 * The person's own link, for the class-ended screen in the room.
 */
exports.link = async (req, res) => {
  try {
    const { kind, id } = req.body || {};
    const data = await classFeedbackService.linkFor({ kind, targetId: id, userId: req.user.id });
    return res.json({ success: true, data });
  } catch (error) {
    return send(res, error, 'We couldn’t open feedback for this class.');
  }
};

/** GET /api/class-feedback/mine  (signed in) The creator's classes/sessions with feedback. */
exports.mine = async (req, res) => {
  try {
    const results = require('../services/classFeedbackResultsService');
    return res.json({ success: true, data: await results.creatorTargets(req.user.id, req.query) });
  } catch (error) {
    return send(res, error, 'We couldn’t load your class feedback.');
  }
};

/** GET /api/class-feedback/mine/:kind/:id  (signed in) What their participants said. */
exports.mineDetail = async (req, res) => {
  const results = require('../services/classFeedbackResultsService');
  try {
    const data = await results.creatorTarget(req.user.id, req.params.kind, req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    if (error instanceof results.ResultsError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return send(res, error, 'We couldn’t load this class’s feedback.');
  }
};

/** POST /api/class-feedback/:token  { overall, answers?, comment?, anonymous? } */
exports.submit = async (req, res) => {
  try {
    return res.json({ success: true, data: await classFeedbackService.submit(req.params.token, req.body) });
  } catch (error) {
    return send(res, error, 'We couldn’t save your feedback. Please try again.');
  }
};
