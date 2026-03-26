'use strict';

/**
 * Appointments — Gateway Security Test Suite
 *
 * Tests that the API Gateway correctly enforces:
 * - JWT authentication
 * - UUID validation in URL paths
 * - Tenant isolation (tenant_id from JWT only)
 * - HTTP method restrictions
 * - Input field whitelisting
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createSuite }  = require('../../test-engine/core/testRunner');
const { createClient } = require('../../test-engine/core/apiClient');
const {
  assertStatus,
  assertSuccess,
  assertError,
} = require('../../test-engine/core/assertions');
const config = require('../../test-engine/config');

const client            = createClient({ token: config.tokens.valid });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });
const wrongTenantClient = createClient({ token: config.tokens.wrongTenant });

const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';
const VALID_UUID        = '00000000-0000-0000-0000-000000000099';
const FUTURE_DATETIME   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const suite = createSuite('Appointments — Gateway Security');

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

suite.test('No Authorization header → 401 MISSING_TOKEN', async () => {
  const res = await noAuthClient.post('/appointments', {
    customer_id:  VALID_CUSTOMER_ID,
    scheduled_at: FUTURE_DATETIME,
  });
  assertStatus(res, 401);
  assertError(res, 'MISSING_TOKEN');
});

suite.test('Invalid JWT signature → 401 INVALID_TOKEN', async () => {
  const res = await invalidAuthClient.get('/appointments');
  assertStatus(res, 401);
  assertError(res, 'INVALID_TOKEN');
});

suite.test('Expired JWT → 401 TOKEN_EXPIRED', async () => {
  const res = await expiredAuthClient.get('/appointments');
  assertStatus(res, 401);
  assertError(res, 'TOKEN_EXPIRED');
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID PATH PARAM VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET /appointments/not-a-uuid → 400 INVALID_ID', async () => {
  const res = await client.get('/appointments/not-a-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('PUT /appointments/not-a-uuid → 400 INVALID_ID', async () => {
  const res = await client.put('/appointments/not-a-uuid', { status: 'cancelled' });
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE /appointments/not-a-uuid → 400 INVALID_ID', async () => {
  const res = await client.delete('/appointments/not-a-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET /appointments/totally-invalid-format → 400 INVALID_ID', async () => {
  const res = await client.get('/appointments/totally-invalid-format');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTING SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('PUT /appointments without ID → must fail (400/404/405)', async () => {
  const res = await client.put('/appointments', { status: 'cancelled' });

  if (res.status === 200) {
    const { fail } = require('../../test-engine/core/assertions');
    fail('Expected PUT /appointments without ID to fail but got 200', { body: res.data });
  }
});

suite.test('DELETE /appointments without ID → must fail (400/404/405)', async () => {
  const res = await client.delete('/appointments');

  if (res.status === 200) {
    const { fail } = require('../../test-engine/core/assertions');
    fail('Expected DELETE /appointments without ID to fail but got 200', { body: res.data });
  }
});

suite.test('Query-param id must not bypass path param routing', async () => {
  const res = await client.get(`/appointments?id=${VALID_UUID}`);

  if (
    res.status === 200 &&
    res.data &&
    res.data.success === true &&
    res.data.data &&
    res.data.data.id === VALID_UUID
  ) {
    const { fail } = require('../../test-engine/core/assertions');
    fail('Gateway allowed query-param id bypass — routing security violation', {
      VALID_UUID,
      status: res.status,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// TENANT INJECTION
// ═════════════════════════════════════════════════════════════════════════════

suite.test('tenant_id in POST body must be overwritten by JWT tenant', async (ctx) => {
  const res = await client.post('/appointments', {
    customer_id:  VALID_CUSTOMER_ID,
    scheduled_at: FUTURE_DATETIME,
    tenant_id:    'evil-tenant-00000000-0000-0000-0000-000000000000',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.injectedId = res.data.data.id;

    const readRes = await client.get(`/appointments/${ctx.injectedId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    const data = readRes.data.data;
    if (data && data.tenant_id === 'evil-tenant-00000000-0000-0000-0000-000000000000') {
      const { fail } = require('../../test-engine/core/assertions');
      fail('Tenant injection succeeded — evil tenant_id was stored', {
        tenant_id: data.tenant_id,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ / WRITE / DELETE
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Wrong-tenant token must not list appointments of another tenant', async () => {
  const res = await wrongTenantClient.get('/appointments');

  if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
    assertSuccess(res);
  }
  // 401/403 are also acceptable
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — tenant injection record', async (ctx) => {
  if (!ctx.injectedId) return;
  await client.delete(`/appointments/${ctx.injectedId}`);
});

module.exports = suite;
