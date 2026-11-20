const results = require('../services/classFeedbackResultsService');

/**
 * Admin: feedback from live classes and series sessions, with who said what
 * (anonymous only hides a name from the host, never from Hallos).
 * Mounted under /api/admin/class-feedback; staff need feedback.classes.
 */

const handle = (action) => async (req, res) => {
  try {
    const data = await action(req);
    if (data === null) return res.status(404).json({ success: false, message: 'We couldn’t find feedback for this class.' });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[Admin class feedback] Request failed:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.overview = handle((req) => results.adminOverview({ days: req.query.days }));
exports.list = handle((req) => results.listTargets(req.query));
exports.detail = handle((req) => results.adminTarget(req.params.kind, req.params.id));
