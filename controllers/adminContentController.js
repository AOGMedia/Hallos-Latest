const moderation = require('../services/contentModerationService');

const handle = (action) => async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof moderation.ModerationError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Admin Content] Request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.listVideos = handle((req) => moderation.listVideos(req.query));
exports.listFreebies = handle((req) => moderation.listFreebies(req.query));
exports.listCourses = handle((req) => moderation.listCourses(req.query));
exports.setCourseActive = handle((req) => moderation.setCourseActive(req.params.id, req.body.isActive));

exports.takeDown = handle((req) =>
  moderation.takeDown({ type: req.params.type, id: req.params.id, reason: req.body.reason, actor: req.user })
);
exports.restore = handle((req) => moderation.restore({ type: req.params.type, id: req.params.id, actor: req.user }));

exports.listReports = handle((req) => moderation.listReports(req.query));
exports.reportCount = handle(async () => ({ open: await moderation.openReportCount() }));
exports.resolveReports = handle((req) =>
  moderation.resolveReports({
    targetType: req.body.targetType,
    targetId: req.body.targetId,
    outcome: req.body.outcome,
    note: req.body.note,
    actor: req.user,
  })
);

/** Public: any signed-in person reporting something. */
exports.createReport = handle((req) =>
  moderation.createReport({
    reporterId: req.user.id,
    targetType: req.body.targetType,
    targetId: req.body.targetId,
    reason: req.body.reason,
    details: req.body.details,
  })
);
