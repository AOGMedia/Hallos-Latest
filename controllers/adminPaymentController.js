const refunds = require('../services/paymentRefundService');

const handle = (action) => async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof refunds.RefundError) {
      return res.status(error.status).json({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}) });
    }
    console.error('[Admin Payments] Request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.listPayments = handle((req) => refunds.listPayments(req.query));
exports.listRefunds = handle((req) => refunds.listRefunds(req.query));
exports.preview = handle((req) => refunds.preview({ source: req.params.source, id: req.params.id }));
exports.refund = handle((req) =>
  refunds.refund({
    source: req.params.source,
    id: req.params.id,
    reason: req.body.reason,
    acceptShortfall: req.body.acceptShortfall,
    actor: req.user,
  })
);
exports.recheck = handle((req) => refunds.recheck(req.params.id));
