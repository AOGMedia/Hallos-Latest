const express = require('express');
const investors = require('../services/investorRelationsService');

const router = express.Router();

/**
 * Public: the published profiles on the investor relations page, in order.
 * 503 (not an empty list) if they can't be read, so the site keeps its
 * built-in profile instead of showing an empty page.
 */
router.get('/', async (req, res) => {
  const profiles = await investors.listPublished();
  if (!profiles) return res.status(503).json({ success: false, message: 'Unavailable right now.' });
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ success: true, data: { profiles } });
});

module.exports = router;
