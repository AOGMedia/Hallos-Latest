const insights = require('../services/userInsightsService');
const actions = require('../services/adminUserActionsService');
const suspensions = require('../services/suspensionService');
const deletion = require('../services/accountDeletionService');
const dataExport = require('../services/dataExportService');

const handle = (action, { allowNull = false } = {}) => async (req, res) => {
  try {
    const data = await action(req);
    if (data === null && !allowNull) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (
      error instanceof actions.UserActionError ||
      error instanceof suspensions.SuspensionError ||
      error instanceof deletion.AccountDeletionError ||
      error instanceof dataExport.DataExportError
    ) {
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

// ---------- Account deletion and data export ----------

exports.listAccountDeletions = handle((req) => deletion.list({ status: req.query.status }));
exports.completeAccountDeletion = handle((req) => deletion.complete({ id: req.params.id, actor: req.user }));
exports.rejectAccountDeletion = handle((req) => deletion.reject({ id: req.params.id, actor: req.user, note: req.body?.note }));

/** The user's open deletion request (null when there's none), with what's in the way. */
exports.getAccountDeletion = handle(
  async (req) => {
    const open = await deletion.openForUser(req.params.id);
    if (!open) return null;
    const blockers = (await deletion.blockersFor([open.userId])).get(Number(open.userId)) || [];
    return { ...open, ready: new Date(open.scheduledFor).getTime() <= Date.now(), blockers };
  },
  { allowNull: true }
);

/** A copy of the user's data, for a support request (the staff action log records who downloaded it). */
exports.exportUserData = async (req, res) => {
  try {
    const data = await dataExport.exportForStaff(req.params.id);
    // Reads aren't logged automatically; this one is sensitive, so record it.
    if (require('../utils/ensureAdminFoundations').isAdminFoundationsReady()) {
      require('../config/db')
        .query(
          `INSERT INTO admin_action_log (actor_id, actor_role, method, path, status, details, ip, user_agent)
           VALUES (:actorId, :actorRole, 'GET', :path, 200, CAST(:details AS JSONB), :ip, :userAgent)`,
          {
            replacements: {
              actorId: req.user.id,
              actorRole: req.user.role || null,
              path: req.originalUrl.split('?')[0].slice(0, 500),
              details: JSON.stringify({ action: 'data_export' }),
              ip: String(req.ip || '').slice(0, 64) || null,
              userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
            },
          }
        )
        .catch((error) => console.warn('[StaffActionLog] Could not record the data export:', error.message));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dataExport.fileName(req.params.id)}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(JSON.stringify(data, null, 2));
  } catch (error) {
    if (error instanceof dataExport.DataExportError) return res.status(error.status).json({ success: false, message: error.message });
    console.error('[Admin User] Data export failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
