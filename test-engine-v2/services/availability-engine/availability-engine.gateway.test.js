'use strict';

/**
 * availability-engine — Gateway / Auth / Input Validation tests  [SCAFFOLD]
 *
 * STATUS: pending — availability-engine n8n workflows must be deployed first.
 *
 * All describe blocks use describe.skip so Jest counts them as pending
 * rather than executing them against a non-existent endpoint.
 *
 * HOW TO ACTIVATE:
 *   1. Deploy all four availability-engine n8n workflows and activate them.
 *   2. Ensure API_BASE_URL points to the running API Gateway.
 *   3. Replace every `describe.skip` with `describe`.
 *   4. Run: npm run test:availability-engine
 *
 * ENDPOINT CONTRACT (V1 — all POST, body contains customer_id):
 *   POST /api/v1/availability-engine/slots
 *   POST /api/v1/availability-engine/check
 *   POST /api/v1/availability-engine/next-free
 *   POST /api/v1/availability-engine/day-view
 */

const { createClient }       = require('../../core/apiClient');
const config                 = require('../../config/config');
const {
  expectUnauthorized,
  expectValidationError,
}                            = require('../../core/assertions');

const ENDPOINTS = {
  slots:    '/api/v1/availability-engine/slots',
  check:    '/api/v1/availability-engine/check',
  nextFree: '/api/v1/availability-engine/next-free',
  dayView:  '/api/v1/availability-engine/day-view',
};

const clientNoToken      = createClient({ token: '' });
const clientInvalidToken = createClient({ token: config.tokens.invalid });
const clientExpiredToken = createClient({ token: config.tokens.expired });
const clientTenantA      = createClient({ token: config.tokens.tenantA });

// A valid customer_id UUID placeholder — real tests should use a seeded ID.
const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

// ── Auth enforcement ───────────────────────────────────────────────────────────

describe.skip('availability-engine / gateway / auth — no token', () => {
  it('POST slots → 401 without token', async () => {
    const res = await clientNoToken.post(ENDPOINTS.slots, {
      customer_id: VALID_CUSTOMER_ID,
      from: new Date(Date.now() + 86400000).toISOString(),
      to:   new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectUnauthorized(res);
  });

  it('POST check → 401 without token', async () => {
    const res = await clientNoToken.post(ENDPOINTS.check, {
      customer_id: VALID_CUSTOMER_ID,
      start:            new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectUnauthorized(res);
  });

  it('POST next-free → 401 without token', async () => {
    const res = await clientNoToken.post(ENDPOINTS.nextFree, {
      customer_id: VALID_CUSTOMER_ID,
      after:            new Date(Date.now() + 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectUnauthorized(res);
  });

  it('POST day-view → 401 without token', async () => {
    const res = await clientNoToken.post(ENDPOINTS.dayView, {
      customer_id: VALID_CUSTOMER_ID,
      date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    });
    expectUnauthorized(res);
  });
});

describe.skip('availability-engine / gateway / auth — invalid token', () => {
  it('POST slots → 401 with invalid token', async () => {
    const res = await clientInvalidToken.post(ENDPOINTS.slots, {
      customer_id: VALID_CUSTOMER_ID,
      from: new Date(Date.now() + 86400000).toISOString(),
      to:   new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectUnauthorized(res);
  });

  it('POST check → 401 with invalid token', async () => {
    const res = await clientInvalidToken.post(ENDPOINTS.check, {
      customer_id: VALID_CUSTOMER_ID,
      start:            new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectUnauthorized(res);
  });

  it('POST next-free → 401 with invalid token', async () => {
    const res = await clientInvalidToken.post(ENDPOINTS.nextFree, {
      customer_id: VALID_CUSTOMER_ID,
      after:            new Date(Date.now() + 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectUnauthorized(res);
  });

  it('POST day-view → 401 with invalid token', async () => {
    const res = await clientInvalidToken.post(ENDPOINTS.dayView, {
      customer_id: VALID_CUSTOMER_ID,
      date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    });
    expectUnauthorized(res);
  });
});

describe.skip('availability-engine / gateway / auth — expired token', () => {
  it('POST slots → 401 with expired token', async () => {
    const res = await clientExpiredToken.post(ENDPOINTS.slots, {
      customer_id: VALID_CUSTOMER_ID,
      from: new Date(Date.now() + 86400000).toISOString(),
      to:   new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectUnauthorized(res);
  });

  it('POST day-view → 401 with expired token', async () => {
    const res = await clientExpiredToken.post(ENDPOINTS.dayView, {
      customer_id: VALID_CUSTOMER_ID,
      date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    });
    expectUnauthorized(res);
  });
});

// ── Input validation ───────────────────────────────────────────────────────────

describe.skip('availability-engine / gateway / input validation', () => {
  it('rejects missing customer_id → 400', async () => {
    const res = await clientTenantA.post(ENDPOINTS.slots, {
      from: new Date(Date.now() + 86400000).toISOString(),
      to:   new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectValidationError(res);
  });

  it('rejects invalid UUID for customer_id → 400', async () => {
    const res = await clientTenantA.post(ENDPOINTS.slots, {
      customer_id:      'not-a-uuid',
      from:             new Date(Date.now() + 86400000).toISOString(),
      to:               new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectValidationError(res);
  });

  it('rejects invalid datetime for `from` → 400', async () => {
    const res = await clientTenantA.post(ENDPOINTS.slots, {
      customer_id:      VALID_CUSTOMER_ID,
      from:             'not-a-date',
      to:               new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    expectValidationError(res);
  });

  it('rejects unknown/invalid timezone → 400', async () => {
    const res = await clientTenantA.post(ENDPOINTS.slots, {
      customer_id:      VALID_CUSTOMER_ID,
      from:             new Date(Date.now() + 86400000).toISOString(),
      to:               new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
      timezone:         'Not/ATimezone',
    });
    expectValidationError(res);
  });

  it('rejects zero or negative duration_minutes → 400', async () => {
    const res = await clientTenantA.post(ENDPOINTS.slots, {
      customer_id:      VALID_CUSTOMER_ID,
      from:             new Date(Date.now() + 86400000).toISOString(),
      to:               new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 0,
    });
    expectValidationError(res);
  });

  it('rejects invalid date string for day-view → 400', async () => {
    const res = await clientTenantA.post(ENDPOINTS.dayView, {
      customer_id: VALID_CUSTOMER_ID,
      date:        '2099-99-99',
    });
    expectValidationError(res);
  });

  it('rejects non-POST methods on availability-engine endpoints → 405', async () => {
    // The gateway only allows POST for these operation routes.
    const res = await clientTenantA.get(ENDPOINTS.slots);
    expect(res.status).toBe(405);
  });
});

// ── Tenant injection guard ─────────────────────────────────────────────────────

describe.skip('availability-engine / gateway / tenant injection', () => {
  it('ignores or strips tenant_id from request body', async () => {
    // The gateway must derive tenant identity solely from the JWT.
    // Passing a foreign tenant_id in the body must not grant cross-tenant data access.
    const res = await clientTenantA.post(ENDPOINTS.slots, {
      tenant_id:        '00000000-0000-0000-0000-000000000000',
      customer_id:      VALID_CUSTOMER_ID,
      from:             new Date(Date.now() + 86400000).toISOString(),
      to:               new Date(Date.now() + 7 * 86400000).toISOString(),
      duration_minutes: 30,
    });
    // Must not be a 500 or an authorization bypass — either 200 (own data) or 400 (rejected)
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      // If 200, the response must reflect TenantA's own data, not the injected tenant
      expect(res.data.success).toBe(true);
    }
  });
});
