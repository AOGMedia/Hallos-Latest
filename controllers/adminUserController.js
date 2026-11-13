const insights = require('../services/userInsightsService');
const actions = require('../services/adminUserActionsService');
const suspensions = require('../services/suspensionService');

const handle = (action) => async (req, res) => {
  try {
    const data = await action(req);
    if (data === null) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof actions.UserActionError || error instanceof suspensions.SuspensionError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Admin User] Request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.getOverview = handle((req) => insights.getOverview(req.params.id));
exports.getActivity = handle((req) => insights.getActivity(req.params.id));

exports.sendEmail = handle((req) =>
  actions.sendPersonalEmail({
    userId: req.params.id,
    senderId: req.user.id,
    subject: req.body.subject,
    preheader: req.body.preheader,
    bodyHtml: req.body.bodyHtml,
  })
);

exports.adjustWallet = handle((req) =>
  actions.adjustWallet({
    userId: req.params.id,
    adminId: req.user.id,
    currency: req.body.currency,
    direction: req.body.direction,
    amount: req.body.amount,
    reason: req.body.reason,
    idempotencyKey: req.body.idempotencyKey,
  })
);

exports.getSuspensions = handle(async (req) => ({
  current: await suspensions.getOpen(req.params.id),
  history: await suspensions.history(req.params.id),
}));

exports.suspend = handle((req) =>
  suspensions.suspend({ userId: req.params.id, actor: req.user, reason: req.body.reason, endsAt: req.body.endsAt })
);

exports.unsuspend = handle((req) =>
  suspensions.lift({ userId: req.params.id, actor: req.user, reason: req.body.reason })
);
