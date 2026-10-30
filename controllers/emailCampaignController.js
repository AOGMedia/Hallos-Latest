const campaignService = require('../services/emailCampaignService');
const audienceService = require('../services/emailAudienceService');
const { describeTransport } = require('../services/emailCampaignMailer');
const { verifyEmailToken, decodeEmailParam, escapeHtml } = require('../utils/campaignEmail');

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (data !== undefined) res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || (error.name === 'SequelizeValidationError' ? 400 : 500);
    if (status >= 500) console.error('[EmailPortal]', req.method, req.originalUrl, error);
    res.status(status).json({
      success: false,
      message: status >= 500 ? 'Something went wrong. Please try again.' : error.message
    });
  }
};

exports.me = handle(async (req) => ({
  id: req.portalUser.id,
  firstname: req.portalUser.firstname,
  lastname: req.portalUser.lastname,
  email: req.portalUser.email,
  role: req.portalUser.role,
  sender: describeTransport()
}));

exports.stats = handle(() => campaignService.getPortalStats());

exports.audienceOptions = handle(() => audienceService.getAudienceOptions());

exports.audiencePreview = handle(async (req) => {
  const audience = audienceService.normalizeAudience(req.body.audience);
  const { users, total } = await audienceService.listAudience(audience, { page: 1, limit: 8 });
  return { total, sample: users, audience };
});

exports.audienceUsers = handle((req) =>
  audienceService.listAudience(req.body.audience, {
    search: req.body.search,
    page: req.body.page,
    limit: req.body.limit
  })
);

exports.createCampaign = handle(async (req, res) => {
  res.status(201);
  return campaignService.createCampaign(req.portalUser.id, req.body);
});

exports.listCampaigns = handle((req) => campaignService.listCampaigns(req.query));

exports.getCampaign = handle((req) => campaignService.getCampaign(req.params.id));

exports.updateCampaign = handle((req) => campaignService.updateCampaign(req.params.id, req.body));

exports.deleteCampaign = handle(async (req) => {
  await campaignService.deleteCampaign(req.params.id);
  return { deleted: true };
});

exports.sendTest = handle((req) => campaignService.sendTest(req.portalUser, req.body));

exports.sendCampaign = handle((req) =>
  campaignService.sendCampaign(req.params.id, req.portalUser.id, { scheduledFor: req.body.scheduledFor })
);

exports.cancelCampaign = handle((req) => campaignService.cancelCampaign(req.params.id));

exports.retryFailed = handle((req) => campaignService.retryFailed(req.params.id));

exports.listRecipients = handle((req) => campaignService.listRecipients(req.params.id, req.query));

exports.exportRecipients = async (req, res) => {
  try {
    const { filename, csv } = await campaignService.exportRecipientsCsv(req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Export failed' });
  }
};

const unsubscribePage = (title, message, form = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:440px;margin:80px auto;background:#fff;border-radius:12px;padding:32px;text-align:center;">
<h2 style="color:#6c5ce7;margin-top:0;">Hallos</h2>
<p style="color:#333;line-height:1.6;">${message}</p>${form}</div></body></html>`;

const readUnsubscribeRequest = (req) => {
  const email = decodeEmailParam(req.query.e);
  return { email, valid: Boolean(email) && verifyEmailToken(email, req.query.t) };
};

exports.unsubscribeConfirm = (req, res) => {
  const { email, valid } = readUnsubscribeRequest(req);
  if (!valid) {
    return res.status(400).send(unsubscribePage('Invalid link', 'This unsubscribe link is not valid or has expired.'));
  }
  const action = `?e=${encodeURIComponent(req.query.e)}&t=${encodeURIComponent(req.query.t)}`;
  return res.send(unsubscribePage(
    'Unsubscribe',
    `Stop receiving marketing emails from Hallos at <strong>${escapeHtml(email)}</strong>?`,
    `<form method="POST" action="${action}"><button type="submit" style="background:#6c5ce7;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:15px;cursor:pointer;">Yes, unsubscribe me</button></form>`
  ));
};

exports.unsubscribe = async (req, res) => {
  const { email, valid } = readUnsubscribeRequest(req);
  if (!valid) {
    return res.status(400).send(unsubscribePage('Invalid link', 'This unsubscribe link is not valid or has expired.'));
  }
  try {
    await campaignService.addSuppression(email, 'unsubscribed');
    return res.send(unsubscribePage('Unsubscribed', 'You have been unsubscribed and will no longer receive marketing emails from Hallos. Account and payment emails will still be sent.'));
  } catch (error) {
    console.error('[EmailPortal] Unsubscribe failed:', error.message);
    return res.status(500).send(unsubscribePage('Something went wrong', 'We could not process your request. Please try again later.'));
  }
};
