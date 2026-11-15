const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/authMiddleware');
const deletion = require('../services/accountDeletionService');
const dataExport = require('../services/dataExportService');

const router = express.Router();

// The deletion request checks a password: keep guessing slow.
const deletionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  keyGenerator: (req) => `account-deletion:${req.user?.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
});

const fail = (res, error, label) => {
  if (error instanceof deletion.AccountDeletionError || error instanceof dataExport.DataExportError) {
    return res.status(error.status).json({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}) });
  }
  console.error(`[Account] ${label} failed:`, error);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

/** GET /api/account/deletion: is a deletion scheduled for me? */
router.get('/deletion', authMiddleware, async (req, res) => {
  try {
    return res.json({ success: true, data: await deletion.statusFor(req.user.id) });
  } catch (error) {
    return fail(res, error, 'Deletion status');
  }
});

/** POST /api/account/deletion { password? | confirmText?, reason? }: ask to delete my account. */
router.post('/deletion', authMiddleware, deletionLimiter, async (req, res) => {
  try {
    const request = await deletion.request({
      userId: req.user.id,
      password: req.body?.password,
      confirmText: req.body?.confirmText,
      reason: req.body?.reason,
    });
    return res.status(201).json({ success: true, data: request });
  } catch (error) {
    return fail(res, error, 'Deletion request');
  }
});

/** DELETE /api/account/deletion: I changed my mind. */
router.delete('/deletion', authMiddleware, async (req, res) => {
  try {
    return res.json({ success: true, data: await deletion.cancel({ userId: req.user.id }) });
  } catch (error) {
    return fail(res, error, 'Deletion cancel');
  }
});

/** GET /api/account/export: download a copy of my data (JSON file). */
router.get('/export', authMiddleware, async (req, res) => {
  try {
    const data = await dataExport.exportForSelf(req.user.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dataExport.fileName(req.user.id)}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(JSON.stringify(data, null, 2));
  } catch (error) {
    return fail(res, error, 'Data export');
  }
});

module.exports = router;
