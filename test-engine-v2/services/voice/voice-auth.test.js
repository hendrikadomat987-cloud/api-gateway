'use strict';

/**
 * Voice — Auth / JWT Enforcement Test
 *
 * Verifies that internal voice endpoints correctly enforce JWT authentication:
 *   - no token      → 401
 *   - invalid token → 401
 *   - valid token   → success (2xx)
 *
 * The public webhook endpoint is excluded — it requires no auth by design.
 */

const config = require('../../config/config');
const { createClient } = require('../../core/apiClient');
const { expectUnauthorized, expectSuccess } = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

const clientNoToken      = createClient({ token: '' });
const clientInvalidToken = createClient({ token: config.tokens.invalid });
const clientExpiredToken = createClient({ token: config.tokens.expired });
const clientTenantA      = createClient({ token: config.tokens.tenantA });

// ── GET /voice/calls ───────────────────────────────────────────────────────────

describe('voice / auth — GET /voice/calls', () => {

  it('no token → 401', async () => {
    const res = await clientNoToken.get('/voice/calls');
    expectUnauthorized(res);
  });

  it('invalid token → 401', async () => {
    const res = await clientInvalidToken.get('/voice/calls');
    expectUnauthorized(res);
  });

  it('expired token → 401', async () => {
    const res = await clientExpiredToken.get('/voice/calls');
    expectUnauthorized(res);
  });

  it('valid token → success', async () => {
    const res = await clientTenantA.get('/voice/calls');
    // Accept 200 with a list (possibly empty) — not 401/403/5xx
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
    expect(res.data.success).toBe(true);
  });
});

// ── GET /voice/calls/:id — non-existent ID as auth probe ──────────────────────

describe('voice / auth — GET /voice/calls/:id', () => {
  const PROBE_ID = 'auth-probe-call-000';

  it('no token → 401', async () => {
    const res = await clientNoToken.get(`/voice/calls/${PROBE_ID}`);
    expectUnauthorized(res);
  });

  it('invalid token → 401', async () => {
    const res = await clientInvalidToken.get(`/voice/calls/${PROBE_ID}`);
    expectUnauthorized(res);
  });

  it('expired token → 401', async () => {
    const res = await clientExpiredToken.get(`/voice/calls/${PROBE_ID}`);
    expectUnauthorized(res);
  });

  it('valid token → not 401 (404 is fine — resource may not exist)', async () => {
    const res = await clientTenantA.get(`/voice/calls/${PROBE_ID}`);
    // 401 would mean auth rejected; 404 means auth passed but resource missing — both acceptable here
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── GET /voice/calls/:id/events ────────────────────────────────────────────────

describe('voice / auth — GET /voice/calls/:id/events', () => {
  const PROBE_ID = 'auth-probe-call-000';

  it('no token → 401', async () => {
    const res = await clientNoToken.get(`/voice/calls/${PROBE_ID}/events`);
    expectUnauthorized(res);
  });

  it('invalid token → 401', async () => {
    const res = await clientInvalidToken.get(`/voice/calls/${PROBE_ID}/events`);
    expectUnauthorized(res);
  });

  it('valid token → not 401', async () => {
    const res = await clientTenantA.get(`/voice/calls/${PROBE_ID}/events`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
