'use strict';

/**
 * Customer CRUD test suite
 *
 * Pattern: Arrange → Act → Assert → Cleanup
 * All tests share a mutable `ctx` object so IDs created early
 * are available to later tests (read, update, delete).
 */

const { createSuite }   = require('../../core/testRunner');
const { createClient }  = require('../../core/apiClient');
const {
  assertStatus,
  assertSuccess,
  assertError,
  assertSchema,
  assertField,
} = require('../../core/assertions');
const config = require('../../config');

// ── Clients ───────────────────────────────────────────────────────────────────
const client             = createClient({ token: config.tokens.valid });
const noAuthClient       = createClient({ token: '' });           // no Authorization header
const invalidAuthClient  = createClient({ token: config.tokens.invalid });
const expiredAuthClient  = createClient({ token: config.tokens.expired });
const wrongTenantClient  = createClient({ token: config.tokens.wrongTenant });

// ── Test data ─────────────────────────────────────────────────────────────────
const VALID_CUSTOMER = {
  name:  'Test User',
  email: 'testuser@example.com',
  phone: '+49123456789',
};

// ── Suite ─────────────────────────────────────────────────────────────────────
const suite = createSuite('Customer CRUD');

// ═════════════════════════════════════════════════════════════════════════════
// SUCCESS CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Create customer — success', async (ctx) => {
  try {
    const res = await client.post('/customer', VALID_CUSTOMER);

    console.log("STATUS:", res.status);
    console.log("RESPONSE:", JSON.stringify(res.data, null, 2));

    assertStatus(res, 200);
    assertSuccess(res);
    assertSchema(res, ['id']);

    ctx.customerId = res.data.data.id;

  } catch (err) {
    if (err.response) {
      console.log("❌ ERROR STATUS:", err.response.status);
      console.log("❌ ERROR RESPONSE:", JSON.stringify(err.response.data, null, 2));
    } else {
      console.log("❌ NETWORK ERROR:", err.message);
    }
    throw err;
  }
}, { critical: true }); // no ID → subsequent tests would all fail

suite.test('Read customer — success', async (ctx) => {
  const res = await client.get(`/customer/${ctx.customerId}`);

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id', 'name', 'email']);
  assertField(res, 'id', ctx.customerId);
});

suite.test('Update customer (full update) — success', async (ctx) => {
  const res = await client.put(`/customer/${ctx.customerId}`, {
    name:  'Updated User',
    email: 'updated@example.com',
    phone: '+49987654321',
  });

  assertStatus(res, 200);
  assertSuccess(res);
});

suite.test('Update customer (partial update — name only) — success', async (ctx) => {
  const res = await client.put(`/customer/${ctx.customerId}`, {
    name: 'Partially Updated',
  });

  assertStatus(res, 200);
  assertSuccess(res);
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('PUT customer — empty body → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/customer/${ctx.customerId}`, {});

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR', 'At least one of name, phone, or email is required');
});

suite.test('PUT customer — invalid email (missing @) → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/customer/${ctx.customerId}`, {
    email: 'notanemail',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR', 'Invalid email format');
});

suite.test('PUT customer — invalid email (missing dot) → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/customer/${ctx.customerId}`, {
    email: 'user@nodot',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR', 'Invalid email format');
});

suite.test('POST customer — missing name → VALIDATION_ERROR', async () => {
  const res = await client.post('/customer', {
    email: 'noname@example.com',
    phone: '+49000000000',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR', 'name is required');
});

suite.test('POST customer — missing email → VALIDATION_ERROR', async () => {
  const res = await client.post('/customer', {
    name: 'No Email',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR', 'email is required');
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET customer — missing token → 401', async (ctx) => {
  const res = await noAuthClient.get(`/customer/${ctx.customerId}`);

  assertStatus(res, 401);
});

suite.test('GET customer — invalid token → 401', async (ctx) => {
  const res = await invalidAuthClient.get(`/customer/${ctx.customerId}`);

  assertStatus(res, 401);
});

suite.test('GET customer — expired token → 401', async (ctx) => {
  const res = await expiredAuthClient.get(`/customer/${ctx.customerId}`);

  assertStatus(res, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TENANT SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET customer — wrong tenant token → must not return data', async (ctx) => {
  const res = await wrongTenantClient.get(`/customer/${ctx.customerId}`);

  // The gateway must respond with 401, 403, or 404 — never 200 with the resource
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant data leak: wrong-tenant token received the resource', {
      customerId: ctx.customerId,
      status: res.status,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('DELETE customer — no ID in path → must fail', async () => {
  const res = await client.delete('/customer');

  // Gateway may respond with 400 (MISSING_ID), 404 (route not found), or 405 (method not allowed)
  if (res.status === 200) {
    const { fail } = require('../../core/assertions');
    fail('Expected failure for DELETE /customer without ID but got 200', { body: res.data });
  }
  if (res.status === 400) {
    assertError(res, 'MISSING_ID');
  }
  // 404 / 405 are also acceptable — the route simply does not exist without an ID
});

suite.test('DELETE customer — invalid UUID → INVALID_ID', async () => {
  const res = await client.delete('/customer/not-a-valid-uuid');

  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE customer — already deleted resource → idempotent success', async () => {
  // Create a temporary customer, delete it once, then attempt a second delete
  const createRes = await client.post('/customer', {
    name:  'Temp Delete Test',
    email: 'temp.delete@example.com',
  });
  assertStatus(createRes, 200);
  const tempId = createRes.data.data.id;

  const firstDelete = await client.delete(`/customer/${tempId}`);
  assertStatus(firstDelete, 200);
  assertSuccess(firstDelete);

  const secondDelete = await client.delete(`/customer/${tempId}`);
  assertStatus(secondDelete, 200);
  assertSuccess(secondDelete);
  assertField(secondDelete, 'deleted', true);
});

// ═════════════════════════════════════════════════════════════════════════════
// GET EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET customer — invalid UUID → INVALID_ID', async () => {
  const res = await client.get('/customer/not-a-valid-uuid');

  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET customer — non-existing UUID → empty result or 404', async () => {
  const NON_EXISTING_ID = '00000000-0000-0000-0000-000000000000';
  const res = await client.get(`/customer/${NON_EXISTING_ID}`);

  if (res.status === 404) {
    assertError(res, 'NOT_FOUND');
  } else if (res.status === 200) {
    const data = res.data && res.data.data;
    if (data && data.id) {
      const { fail } = require('../../core/assertions');
      fail('Expected empty/null result for non-existing UUID but got a record', { data });
    }
  } else {
    assertStatus(res, 404); // forces a descriptive failure message
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('CREATE customer — special characters (ÖÄÜ ß emoji) — success', async (ctx) => {
  const res = await client.post('/customer', {
    name:  'Müller-Öztürk 🎉',
    email: 'mueller.oeztuerk@example.com',
    phone: '+49123456789',
  });

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);

  ctx.specialCharCustomerId = res.data.data.id;
});

suite.test('CREATE customer — UTF-8 name round-trip preserved', async (ctx) => {
  if (!ctx.specialCharCustomerId) return;

  const res = await client.get(`/customer/${ctx.specialCharCustomerId}`);

  assertStatus(res, 200);
  assertSuccess(res);
  assertField(res, 'name', 'Müller-Öztürk 🎉');
});

suite.test('CREATE customer — duplicate inserts — system remains stable', async (ctx) => {
  const DUPLICATE_PAYLOAD = {
    name:  'Duplicate Stability Test',
    email: 'duplicate.stability@example.com',
    phone: '+49111111111',
  };

  const res1 = await client.post('/customer', DUPLICATE_PAYLOAD);
  const res2 = await client.post('/customer', DUPLICATE_PAYLOAD);
  const res3 = await client.post('/customer', DUPLICATE_PAYLOAD);

  // Each insert must either succeed (200) or fail gracefully (400/409) — never crash
  const { fail } = require('../../core/assertions');
  [res1, res2, res3].forEach((res, i) => {
    if (res.status !== 200 && res.status !== 400 && res.status !== 409) {
      fail(`Duplicate insert ${i + 1} returned unexpected status ${res.status}`, { body: res.data });
    }
  });

  // Collect created IDs for cleanup
  ctx.duplicateIds = [res1, res2, res3]
    .filter((r) => r.status === 200 && r.data && r.data.data && r.data.data.id)
    .map((r) => r.data.data.id);
});

// ═════════════════════════════════════════════════════════════════════════════
// GATEWAY VALIDATION TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Gateway — PUT without ID → must fail', async () => {
  const res = await client.put('/customer', { name: 'No ID Attempt' });

  if (res.status === 200) {
    const { fail } = require('../../core/assertions');
    fail('Expected PUT /customer without ID to fail but got 200', { body: res.data });
  }
  // 400 (MISSING_ID), 404 (route not found), 405 (method not allowed) are all acceptable
});

suite.test('Gateway — DELETE without ID → must fail', async () => {
  const res = await client.delete('/customer');

  if (res.status === 200) {
    const { fail } = require('../../core/assertions');
    fail('Expected DELETE /customer without ID to fail but got 200', { body: res.data });
  }
  // 400, 404, 405 are all acceptable
});

suite.test('Gateway — invalid UUID in URL path → INVALID_ID', async () => {
  const res = await client.get('/customer/totally-invalid-id-format');

  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('Gateway — query param id must not bypass path param validation', async (ctx) => {
  // Attempt to read a resource via ?id=... query param instead of a path param
  const res = await client.get(`/customer?id=${ctx.customerId}`);

  // Must not return the targeted resource via query-param bypass
  if (
    res.status === 200 &&
    res.data &&
    res.data.success === true &&
    res.data.data &&
    res.data.data.id === ctx.customerId
  ) {
    const { fail } = require('../../core/assertions');
    fail('Gateway allowed query-param id bypass — routing security violation', {
      customerId: ctx.customerId,
      status: res.status,
    });
  }
  // 400, 404, 405 or an empty list are all acceptable outcomes
});

// ═════════════════════════════════════════════════════════════════════════════
// SECURITY TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Security — tenant_id in body must be ignored / overwritten by gateway', async (ctx) => {
  const res = await client.post('/customer', {
    name:      'Tenant Injection Test',
    email:     'tenant.inject@example.com',
    tenant_id: 'evil-tenant-id-99999',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.tenantInjectionId = res.data.data.id;

    // Verify the record is accessible under the correct tenant
    const readRes = await client.get(`/customer/${ctx.tenantInjectionId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    const returnedData = readRes.data.data;
    if (returnedData.tenant_id && returnedData.tenant_id === 'evil-tenant-id-99999') {
      const { fail } = require('../../core/assertions');
      fail('Tenant injection succeeded — spoofed tenant_id in body was persisted', {
        returned_tenant_id: returnedData.tenant_id,
      });
    }
  }
  // 400 is acceptable if the gateway rejects unknown/unexpected body fields
});

suite.test('Security — extra body fields must be ignored / not persisted', async (ctx) => {
  const res = await client.post('/customer', {
    name:          'Body Injection Test',
    email:         'body.inject@example.com',
    role:          'admin',
    is_admin:      true,
    injectedField: 'INJECTED_VALUE',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.bodyInjectionId = res.data.data.id;

    const readRes = await client.get(`/customer/${ctx.bodyInjectionId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    const data = readRes.data.data;
    const injectedFields = ['role', 'is_admin', 'injectedField'].filter((f) => f in data);
    if (injectedFields.length > 0) {
      const { fail } = require('../../core/assertions');
      fail('Unexpected fields were persisted in the customer record', {
        injectedFields,
        returnedData: data,
      });
    }
  }
  // 400 is acceptable if the gateway rejects unexpected fields
});

suite.test('Security — cross-tenant: wrong-tenant token must not read valid customer', async (ctx) => {
  const res = await wrongTenantClient.get(`/customer/${ctx.customerId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant data leak: wrong-tenant token received customer data', {
      customerId: ctx.customerId,
      status: res.status,
    });
  }
  // 401, 403, 404 are all acceptable — resource must not be returned
});

suite.test('Security — cross-tenant: wrong-tenant token must not update valid customer', async (ctx) => {
  const res = await wrongTenantClient.put(`/customer/${ctx.customerId}`, {
    name: 'CROSS_TENANT_HACK',
  });

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant write violation: wrong-tenant token updated the customer', {
      customerId: ctx.customerId,
      status: res.status,
    });
  }
});

suite.test('Security — cross-tenant: wrong-tenant token must not delete valid customer', async (ctx) => {
  const res = await wrongTenantClient.delete(`/customer/${ctx.customerId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant delete violation: wrong-tenant token deleted the customer', {
      customerId: ctx.customerId,
      status: res.status,
    });
  }

  // Confirm customer still exists after the blocked cross-tenant delete attempt
  if (res.status !== 200) {
    const verifyRes = await client.get(`/customer/${ctx.customerId}`);
    assertStatus(verifyRes, 200);
    assertSuccess(verifyRes);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// EXTENDED CLEANUP  (customers created by edge-case / security tests)
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — special-char customer', async (ctx) => {
  if (!ctx.specialCharCustomerId) return;
  const res = await client.delete(`/customer/${ctx.specialCharCustomerId}`);
  assertStatus(res, 200);
});

suite.test('Cleanup — duplicate-insert customers', async (ctx) => {
  if (!ctx.duplicateIds || ctx.duplicateIds.length === 0) return;
  for (const id of ctx.duplicateIds) {
    await client.delete(`/customer/${id}`);
  }
});

suite.test('Cleanup — tenant-injection customer', async (ctx) => {
  if (!ctx.tenantInjectionId) return;
  const res = await client.delete(`/customer/${ctx.tenantInjectionId}`);
  assertStatus(res, 200);
});

suite.test('Cleanup — body-injection customer', async (ctx) => {
  if (!ctx.bodyInjectionId) return;
  const res = await client.delete(`/customer/${ctx.bodyInjectionId}`);
  assertStatus(res, 200);
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Delete customer — cleanup', async (ctx) => {
  if (!ctx.customerId) return; // nothing to clean up

  const res = await client.delete(`/customer/${ctx.customerId}`);

  assertStatus(res, 200);
  assertSuccess(res);
});

// ── Export for run-tests.js ───────────────────────────────────────────────────
module.exports = suite;
