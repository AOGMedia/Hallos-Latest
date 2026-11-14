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

// Creator earnings that never reached the ledger (super admin only).
const missed = require('../services/missedEarningsService');
const handleMissed = (action) => async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof missed.MissedEarningsError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Admin Payments] Missed earnings request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
exports.listMissedEarnings = handleMissed(() => missed.listMissed());

// Live and test mode for the payment gateways (super admin only).
const gatewayMode = require('../services/gatewayModeService');
const handleGateway = (action) => async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof gatewayMode.GatewayModeError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Admin Payments] Gateway settings request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
exports.gatewaySettings = handleGateway(() => gatewayMode.getSettings());
exports.setGatewayMode = handleGateway((req) =>
  gatewayMode.setMode({ gateway: req.params.gateway, mode: req.body.mode, note: req.body.note, actor: req.user })
);
exports.addTestAccount = handleGateway((req) => gatewayMode.addTestAccount({ userId: req.body.userId, actor: req.user }));
exports.removeTestAccount = handleGateway((req) => gatewayMode.removeTestAccount({ userId: req.params.userId }));

// Platform settings editable without a redeploy (super admin only).
const settings = require('../services/platformSettingsService');
const handleSettings = (action) => async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof settings.SettingsError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Admin Settings] Request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
exports.listSettings = handleSettings(() => settings.list());
exports.updateSetting = handleSettings((req) => settings.set({ key: req.params.key, value: req.body.value, note: req.body.note, actor: req.user }));
exports.resetSetting = handleSettings((req) => settings.reset({ key: req.params.key, actor: req.user }));

// Payments that reached a gateway but never got recorded (super admin only).
const stuck = require('../services/stuckPaymentsService');
const handleStuck = (action) => async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof stuck.StuckPaymentError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Admin Payments] Stuck payments request failed:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
exports.listStuckPayments = handleStuck((req) => stuck.listStuck({ days: req.query.days, refresh: req.query.refresh === '1' }));
exports.settleStuckPayment = handleStuck((req) => stuck.settle({ gateway: req.body.gateway, reference: req.body.reference, actor: req.user }));
exports.creditMissedEarnings = handleMissed((req) => missed.creditMissed({ purchaseIds: req.body.purchaseIds, actor: req.user }));
