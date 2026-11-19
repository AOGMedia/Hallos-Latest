/**
 * Health checks: liveness (/health) and readiness (/health/ready).
 * Uses a stand-in database — needs no real one.
 */

const express = require('express');
const request = require('supertest');
const { createHealthRouter, databaseAnswers, DB_CHECK_TIMEOUT_MS } = require('../routes/healthRoutes');

const appWith = (sequelize) => {
  const app = express();
  app.use('/health', createHealthRouter({ sequelize }));
  return app;
};

const db = (behaviour) => ({ query: jest.fn(behaviour) });

describe('GET /health (liveness)', () => {
  test('answers 200 ok without touching the database, never cached', async () => {
    const sequelize = db(async () => [[{ '?column?': 1 }]]);
    const res = await request(appWith(sequelize)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  test('HEAD works (status only)', async () => {
    const res = await request(appWith(db(async () => []))).head('/health');
    expect(res.status).toBe(200);
    expect(res.text).toBeFalsy();
  });

  test('says nothing sensitive', async () => {
    const res = await request(appWith(db(async () => []))).get('/health');
    expect(Object.keys(res.body).sort()).toEqual(['status', 'timestamp', 'uptimeSeconds']);
  });
});

describe('GET /health/ready (readiness)', () => {
  test('200 when the database answers', async () => {
    const sequelize = db(async () => [[{ '?column?': 1 }]]);
    const res = await request(appWith(sequelize)).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
    expect(sequelize.query).toHaveBeenCalledWith('SELECT 1');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  test('503 when the database errors, without leaking the error', async () => {
    const res = await request(appWith(db(async () => { throw new Error('password authentication failed for user x'); }))).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'unavailable', checks: { database: 'unavailable' } });
    expect(JSON.stringify(res.body)).not.toMatch(/password|authentication/);
  });

  test('a database that hangs counts as unavailable after the timeout', async () => {
    const hanging = db(() => new Promise(() => {}));
    const started = Date.now();
    await expect(databaseAnswers(hanging, 50)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(DB_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(5000); // checks must stay quick
  });

  test('503 with no database configured', async () => {
    const res = await request(appWith(undefined)).get('/health/ready');
    expect(res.status).toBe(503);
  });
});
