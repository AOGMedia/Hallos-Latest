const express = require('express');
const featuredEvent = require('../services/featuredEventService');

const router = express.Router();

/**
 * Public: the featured event's page content (name, dates, price, text).
 * No sign-in; nothing private in it. The service never throws and falls back
 * to the built-in defaults, so the events page always has something to show.
 */
router.get('/featured', async (req, res) => {
  const data = await featuredEvent.get();
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ success: true, data });
});

module.exports = router;
