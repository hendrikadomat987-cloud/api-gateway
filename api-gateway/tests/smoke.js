'use strict';

/**
 * Minimal smoke-test — no test framework required.
 * Generates a real JWT using the configured secret and hits each endpoint.
 *
 * Usage:  JWT_SECRET=your-secret node tests/smoke.js
 */

require('dotenv').config();

const http = require('http');
const jwt  = require('jsonwebtoken');

const BASE   = `http://localhost:${process.env.PORT || 3000}`;
const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  console.error('Set JWT_SECRET before running smoke tests');
  process.exit(1);
}

const token = jwt.sign(
  { sub: 'smoke-test-user', roles: ['admin'] },
  SECRET,
  { algorithm: 'HS256', expiresIn: '5m' }
);

const AUTH = `Bearer ${token}`;

// ── Tiny HTTP helper ───────────────────────────────────────────────────────
function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: process.env.PORT || 3000, path, headers };
    http.get(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────
async function run() {
  let passed = 0, failed = 0;

  async function test(label, fn) {
    try {
      await fn();
      console.log(`  ✓  ${label}`);
      passed++;
    } catch (err) {
      console.error(`  ✗  ${label}: ${err.message}`);
      failed++;
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  console.log(`\nSmoke tests → ${BASE}\n`);

  await test('GET /ping → 200', async () => {
    const r = await get('/ping');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.ok === true, 'Expected ok: true');
  });

  await test('GET /api/health → 200', async () => {
    const r = await get('/api/health');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.status === 'ok', 'Expected status: ok');
  });

  await test('GET /api/services → 200', async () => {
    const r = await get('/api/services');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.body.data), 'Expected data array');
  });

  await test('Protected route without token → 401', async () => {
    const r = await get('/api/v1/customer');
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test('Protected route with expired/invalid token → 401', async () => {
    const r = await get('/api/v1/customer', { Authorization: 'Bearer bad.token.here' });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test('Unknown service → 404', async () => {
    const r = await get('/api/v1/nonexistent', { Authorization: AUTH });
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test('Invalid version format → 400', async () => {
    const r = await get('/api/latest/customer', { Authorization: AUTH });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test('Unknown route → 404', async () => {
    const r = await get('/totally/unknown');
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Smoke test runner error:', err.message);
  process.exit(1);
});
