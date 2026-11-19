const express = require('express');

/**
 * Health checks, the standard liveness / readiness pair.
 *
 *   GET|HEAD /health        Liveness: the process is up and serving requests.
 *                            No database, no auth — instant. The website's
 *                            network checker uses it to tell "Hallos is
 *                            unreachable" apart from "your internet is off".
 *   GET|HEAD /health/ready  Readiness: also confirms the database answers
 *                            (SELECT 1, short timeout). 200 when ready, 503
 *                            when not — for Render health checks and uptime
 *                            monitors.
 *
 * Mounted before rate limiting and the rest of the middleware, so checks are
 * cheap and never use up anyone's request allowance. Never cached. Bodies say
 * nothing sensitive: no versions, hostnames or error details.
 */

const DB_CHECK_TIMEOUT_MS = 2000;

const noStore = (res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
};

/** Resolves true if the database answers SELECT 1 within the timeout. */
async function databaseAnswers(sequelize, timeoutMs = DB_CHECK_TIMEOUT_MS) {
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const query = sequelize.query('SELECT 1').then(() => true, () => false);
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function createHealthRouter({ sequelize, now = () => Date.now() } = {}) {
  const router = express.Router();

  // Express answers HEAD from GET handlers (status + headers, no body).
  router.get('/', (req, res) => {
    noStore(res);
    res.status(200).json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date(now()).toISOString()
    });
  });

  router.get('/ready', async (req, res) => {
    noStore(res);
    const started = now();
    const dbOk = sequelize ? await databaseAnswers(sequelize) : false;
    const body = {
      status: dbOk ? 'ok' : 'unavailable',
      checks: { database: dbOk ? 'ok' : 'unavailable' },
      durationMs: Math.max(0, now() - started),
      timestamp: new Date(now()).toISOString()
    };
    res.status(dbOk ? 200 : 503).json(body);
  });

  return router;
}

module.exports = { createHealthRouter, databaseAnswers, DB_CHECK_TIMEOUT_MS };
