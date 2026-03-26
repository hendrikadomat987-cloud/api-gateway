'use strict';

/**
 * Requests CRUD test suite
 *
 * Pattern: Arrange → Act → Assert → Cleanup
 * All tests share a mutable `ctx` object so IDs created early
 * are available to later tests (read, update, delete).
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createSuite }  = require('../../core/testRunner');
const { createClient } = require('../../core/apiClient');
const {
  assertStatus,
  assertSuccess,
  assertError,
  assertSchema,
  assertField,
} = require('../../core/assertions');
const config = require('../../config');

// ── Clients ───────────────────────────────────────────────────────────────────
const client            = createClient({ token: config.tokens.valid });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });
const wrongTenantClient = createClient({ token: config.tokens.wrongTenant });

// ── Test data ─────────────────────────────────────────────────────────────────
const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001'; // must exist in DB for your tenant

const VALID_REQUEST = {
  customer_id: VALID_CUSTOMER_ID,
  type:        'support',
  status:      'pending',
  notes:       'Initial support request',
};

const suite = createSuite('Requests CRUD');

// ═════════════════════════════════════════════════════════════════════════════
// SUCCESS CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Create request — success', async (ctx) => {
  const res = await client.post('/requests', VALID_REQUEST);

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);

  ctx.requestId = res.data.data.id;
}, { critical: true });

suite.test('List requests — success', async (ctx) => {
  const res = await client.get('/requests');

  assertStatus(res, 200);
  assertSuccess(res);
  // data must be an array
  const data = res.data.data;
  if (!Array.isArray(data)) {
    const { fail } = require('../../core/assertions');
    fail('Expected data to be an array for list response', { data });
  }
});

suite.test('Get request by ID — success', async (ctx) => {
  const res = await client.get(`/requests/${ctx.requestId}`);

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id', 'type', 'status']);
  assertField(res, 'id', ctx.requestId);
});

suite.test('Update request (full update) — success', async (ctx) => {
  const res = await client.put(`/requests/${ctx.requestId}`, {
    type:   'callback',
    status: 'in_progress',
    notes:  'Updated notes',
  });

  assertStatus(res, 200);
  assertSuccess(res);
});

suite.test('Update request (partial — status only) — success', async (ctx) => {
  const res = await client.put(`/requests/${ctx.requestId}`, {
    status: 'resolved',
  });

  assertStatus(res, 200);
  assertSuccess(res);
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('POST request — missing type → VALIDATION_ERROR', async () => {
  const res = await client.post('/requests', {
    customer_id: VALID_CUSTOMER_ID,
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST request — invalid type → VALIDATION_ERROR', async () => {
  const res = await client.post('/requests', {
    customer_id: VALID_CUSTOMER_ID,
    type:        'unknown_type',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST request — missing customer_id → VALIDATION_ERROR', async () => {
  const res = await client.post('/requests', {
    type: 'support',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST request — invalid customer_id UUID → VALIDATION_ERROR', async () => {
  const res = await client.post('/requests', {
    customer_id: 'not-a-uuid',
    type:        'support',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT request — empty body → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/requests/${ctx.requestId}`, {});

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT request — invalid status → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/requests/${ctx.requestId}`, {
    status: 'unknown_status',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET request — missing token → 401', async (ctx) => {
  const res = await noAuthClient.get(`/requests/${ctx.requestId}`);
  assertStatus(res, 401);
});

suite.test('GET request — invalid token → 401', async (ctx) => {
  const res = await invalidAuthClient.get(`/requests/${ctx.requestId}`);
  assertStatus(res, 401);
});

suite.test('GET request — expired token → 401', async (ctx) => {
  const res = await expiredAuthClient.get(`/requests/${ctx.requestId}`);
  assertStatus(res, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TENANT SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET request — wrong tenant → must not return data', async (ctx) => {
  const res = await wrongTenantClient.get(`/requests/${ctx.requestId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant data leak: wrong-tenant token received the resource', {
      requestId: ctx.requestId,
      status: res.status,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('DELETE request — invalid UUID → INVALID_ID', async () => {
  const res = await client.delete('/requests/not-a-valid-uuid');

  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE request — already deleted → idempotent success', async () => {
  const createRes = await client.post('/requests', {
    customer_id: VALID_CUSTOMER_ID,
    type:        'info',
  });
  assertStatus(createRes, 200);
  const tempId = createRes.data.data.id;

  const first  = await client.delete(`/requests/${tempId}`);
  assertStatus(first, 200);
  assertSuccess(first);

  const second = await client.delete(`/requests/${tempId}`);
  assertStatus(second, 200);
  assertSuccess(second);
  assertField(second, 'deleted', true);
});

// ═════════════════════════════════════════════════════════════════════════════
// GET EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET request — invalid UUID → INVALID_ID', async () => {
  const res = await client.get('/requests/not-a-valid-uuid');

  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET request — non-existing UUID → 404 or empty', async () => {
  const NON_EXISTING = '00000000-0000-0000-0000-000000000000';
  const res = await client.get(`/requests/${NON_EXISTING}`);

  if (res.status === 404) {
    assertError(res, 'NOT_FOUND');
  } else if (res.status === 200) {
    const data = res.data && res.data.data;
    if (data && data.id) {
      const { fail } = require('../../core/assertions');
      fail('Expected empty/null for non-existing UUID but got a record', { data });
    }
  } else {
    assertStatus(res, 404);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SECURITY TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Security — tenant_id in body must be ignored', async (ctx) => {
  const res = await client.post('/requests', {
    customer_id: VALID_CUSTOMER_ID,
    type:        'support',
    tenant_id:   'evil-tenant-id-99999',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.tenantInjectionId = res.data.data.id;

    const readRes = await client.get(`/requests/${ctx.tenantInjectionId}`);
    assertStatus(readRes, 200);
    const returnedData = readRes.data.data;
    if (returnedData && returnedData.tenant_id === 'evil-tenant-id-99999') {
      const { fail } = require('../../core/assertions');
      fail('Tenant injection succeeded — spoofed tenant_id was persisted', {
        returned_tenant_id: returnedData.tenant_id,
      });
    }
  }
});

suite.test('Security — extra body fields must not be persisted', async (ctx) => {
  const res = await client.post('/requests', {
    customer_id:   VALID_CUSTOMER_ID,
    type:          'quote',
    role:          'admin',
    injectedField: 'INJECTED_VALUE',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.bodyInjectionId = res.data.data.id;

    const readRes = await client.get(`/requests/${ctx.bodyInjectionId}`);
    assertStatus(readRes, 200);
    const data = readRes.data.data;
    const injectedFields = ['role', 'injectedField'].filter((f) => f in data);
    if (injectedFields.length > 0) {
      const { fail } = require('../../core/assertions');
      fail('Unexpected fields were persisted in the request record', {
        injectedFields,
        returnedData: data,
      });
    }
  }
});

suite.test('Security — cross-tenant: wrong-tenant must not update request', async (ctx) => {
  const res = await wrongTenantClient.put(`/requests/${ctx.requestId}`, {
    status: 'closed',
  });

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant write violation: wrong-tenant token updated the request', {
      requestId: ctx.requestId,
    });
  }
});

suite.test('Security — cross-tenant: wrong-tenant must not delete request', async (ctx) => {
  const res = await wrongTenantClient.delete(`/requests/${ctx.requestId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant delete violation: wrong-tenant token deleted the request', {
      requestId: ctx.requestId,
    });
  }

  if (res.status !== 200) {
    const verifyRes = await client.get(`/requests/${ctx.requestId}`);
    assertStatus(verifyRes, 200);
    assertSuccess(verifyRes);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — tenant-injection request', async (ctx) => {
  if (!ctx.tenantInjectionId) return;
  await client.delete(`/requests/${ctx.tenantInjectionId}`);
});

suite.test('Cleanup — body-injection request', async (ctx) => {
  if (!ctx.bodyInjectionId) return;
  await client.delete(`/requests/${ctx.bodyInjectionId}`);
});

suite.test('Delete request — cleanup', async (ctx) => {
  if (!ctx.requestId) return;

  const res = await client.delete(`/requests/${ctx.requestId}`);

  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
