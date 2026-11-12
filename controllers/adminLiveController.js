const live = require('../services/adminLiveService');

const handle = (action) => async (req, res) => {
  try {
    const data = await action(req);
    if (data === null) return res.status(404).json({ success: false, message: 'Not found' });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof live.AdminLiveError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Admin Live] Request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.getOverview = handle(() => live.getOverview());
exports.listClasses = handle((req) => live.listClasses(req.query));
exports.getClass = handle((req) => live.getClass(req.params.id));
exports.endClass = handle((req) => live.forceEndClass(req.params.id, req.user.id));
exports.listSeries = handle((req) => live.listSeries(req.query));
exports.getSeries = handle((req) => live.getSeries(req.params.id));
exports.endSession = handle((req) => live.forceEndSession(req.params.id, req.user.id));
