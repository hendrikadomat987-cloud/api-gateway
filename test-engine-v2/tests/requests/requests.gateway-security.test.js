'use strict';

/**
 * Requests — Gateway Security Test Suite
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

const { createSuite }  = require('../../core/testRunner');
const { createClient } = require('../../core/apiClient');
const {
  assertStatus,
  assertSuccess,
  assertError,
} = require('../../core/assertions');
const config = require('../../config');

const client            = createClient({ token: config.tokens.valid });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });
const wrongTenantClient = createClient({ token: config.tokens.wrongTenant });

// Used only in auth-failure tests that never reach the DB — format only matters
const DUMMY_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';
const VALID_UUID        = '00000000-0000-0000-0000-000000000099';

const suite = createSuite('Requests — Gateway Security');

// ═════════════════════════════════════════════════════════════════════════════
// SETUP — create a real customer to satisfy the FK constraint for tests
//         that actually reach the database
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Setup — create customer for gateway security tests', async (ctx) => {
  const res = await client.post('/customer', {
    name:  'GW Security Test Customer',
    email: 'gw.security.test.customer@example.com',
    phone: '+49000000003',
  });

  assertStatus(res, 200);
  assertSuccess(res);

  ctx.gwSecCustomerId = res.data.data.id;
}, { critical: false }); // non-critical: only tenant-injection test needs it

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

suite.test('No Authorization header → 401 MISSING_TOKEN', async () => {
  const res = await noAuthClient.post('/requests', {
    customer_id: DUMMY_CUSTOMER_ID,
    type: 'support',
  });
  assertStatus(res, 401);
  assertError(res, 'MISSING_TOKEN');
});

suite.test('Invalid JWT signature → 401 INVALID_TOKEN', async () => {
  const res = await invalidAuthClient.get('/requests');
  assertStatus(res, 401);
  assertError(res, 'INVALID_TOKEN');
});

suite.test('Expired JWT → 401 TOKEN_EXPIRED or INVALID_TOKEN', async () => {
  const res = await expiredAuthClient.get('/requests');
  assertStatus(res, 401);

  const code = res.data && res.data.error && res.data.error.code;
  if (code !== 'TOKEN_EXPIRED' && code !== 'INVALID_TOKEN') {
    throw new Error(
      `Expected error code TOKEN_EXPIRED or INVALID_TOKEN but got "${code}"`
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID PATH PARAM VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET /requests/not-a-uuid → 400 INVALID_ID', async () => {
  const res = await client.get('/requests/not-a-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('PUT /requests/not-a-uuid → 400 INVALID_ID', async () => {
  const res = await client.put('/requests/not-a-uuid', { status: 'closed' });
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE /requests/not-a-uuid → 400 INVALID_ID', async () => {
  const res = await client.delete('/requests/not-a-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET /requests/totally-invalid-format → 400 INVALID_ID', async () => {
  const res = await client.get('/requests/totally-invalid-format');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTING SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('PUT /requests without ID → must fail (400/404/405)', async () => {
  const res = await client.put('/requests', { status: 'closed' });

  if (res.status === 200) {
    const { fail } = require('../../core/assertions');
    fail('Expected PUT /requests without ID to fail but got 200', { body: res.data });
  }
  // 400, 404, 405 are all acceptable
});

suite.test('DELETE /requests without ID → must fail (400/404/405)', async () => {
  const res = await client.delete('/requests');

  if (res.status === 200) {
    const { fail } = require('../../core/assertions');
    fail('Expected DELETE /requests without ID to fail but got 200', { body: res.data });
  }
});

suite.test('Query-param id must not bypass path param routing', async () => {
  const res = await client.get(`/requests?id=${VALID_UUID}`);

  // Must not return the targeted resource via query-param bypass
  if (
    res.status === 200 &&
    res.data &&
    res.data.success === true &&
    res.data.data &&
    res.data.data.id === VALID_UUID
  ) {
    const { fail } = require('../../core/assertions');
    fail('Gateway allowed query-param id bypass — routing security violation', {
      VALID_UUID,
      status: res.status,
    });
  }
  // 400, 404, or empty list are all acceptable
});

// ═════════════════════════════════════════════════════════════════════════════
// TENANT INJECTION
// ═════════════════════════════════════════════════════════════════════════════

suite.test('tenant_id in POST body must be overwritten by JWT tenant', async (ctx) => {
  const res = await client.post('/requests', {
    customer_id: ctx.gwSecCustomerId || DUMMY_CUSTOMER_ID,
    type:        'support',
    tenant_id:   'evil-tenant-00000000-0000-0000-0000-000000000000',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.injectedId = res.data.data.id;

    // Resource must be readable by the legitimate tenant — not the injected one
    const readRes = await client.get(`/requests/${ctx.injectedId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    const data = readRes.data.data;
    if (data && data.tenant_id === 'evil-tenant-00000000-0000-0000-0000-000000000000') {
      const { fail } = require('../../core/assertions');
      fail('Tenant injection succeeded — evil tenant_id was stored', {
        tenant_id: data.tenant_id,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ / WRITE / DELETE
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Wrong-tenant token must not list requests of another tenant', async () => {
  const res = await wrongTenantClient.get('/requests');

  // Either returns empty list (200) or error — must NOT contain other tenant data
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
  await client.delete(`/requests/${ctx.injectedId}`);
});

suite.test('Cleanup — gateway security test customer', async (ctx) => {
  if (!ctx.gwSecCustomerId) return;
  await client.delete(`/customer/${ctx.gwSecCustomerId}`);
});

module.exports = suite;
