'use strict';

/**
 * Customer RLS / Tenant-Isolation test suite
 *
 * Verifies that Row Level Security (RLS) and FORCE RLS are enforced
 * end-to-end: Gateway → n8n → Supabase RPC → PostgreSQL.
 *
 * Every test in this suite is a security assertion, not a CRUD comfort test.
 * A passing test means the isolation boundary held; a failing test means
 * a potential data-leak or cross-tenant write has been detected.
 *
 * Pattern: Arrange (create owned resource) → Attack (use wrong-tenant client)
 *          → Assert (no success) → Verify (owned resource still intact)
 *          → Cleanup (remove owned resource)
 */

const { createSuite }  = require('../../core/testRunner');
const { createClient } = require('../../core/apiClient');
const {
  assertStatus,
  assertSuccess,
  assertSchema,
  assertField,
  fail,
} = require('../../core/assertions');
const config = require('../../config');

// ── Clients ───────────────────────────────────────────────────────────────────
const client            = createClient({ token: config.tokens.valid });
const wrongTenantClient = createClient({ token: config.tokens.wrongTenant });

// ── Suite ─────────────────────────────────────────────────────────────────────
const suite = createSuite('Customer RLS / Tenant Isolation');

// ═════════════════════════════════════════════════════════════════════════════
// SETUP  —  create a single owned customer used by all attack tests
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS setup — create owned customer for isolation tests', async (ctx) => {
  const res = await client.post('/customer', {
    name:  'RLS Test Target',
    email: 'rls.target@example.com',
    phone: '+49000000001',
  });

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);

  ctx.rlsCustomerId = res.data.data.id;
}, { critical: true }); // all subsequent tests depend on this ID

// ═════════════════════════════════════════════════════════════════════════════
// READ ISOLATION
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — wrong-tenant token must not read valid customer', async (ctx) => {
  const res = await wrongTenantClient.get(`/customer/${ctx.rlsCustomerId}`);

  // 401 / 403 / 404 are all acceptable — what is NOT acceptable is 200 + data
  if (res.status === 200 && res.data && res.data.success === true) {
    fail('Cross-tenant data leak: wrong-tenant token received customer data', {
      customerId: ctx.rlsCustomerId,
      status: res.status,
      data: res.data,
    });
  }

  // Verify the resource still exists under the correct tenant
  const verifyRes = await client.get(`/customer/${ctx.rlsCustomerId}`);
  assertStatus(verifyRes, 200);
  assertSuccess(verifyRes);
  assertField(verifyRes, 'id', ctx.rlsCustomerId);
});

// ═════════════════════════════════════════════════════════════════════════════
// UPDATE ISOLATION
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — wrong-tenant token must not update valid customer', async (ctx) => {
  const res = await wrongTenantClient.put(`/customer/${ctx.rlsCustomerId}`, {
    name: 'CROSS_TENANT_WRITE',
  });

  if (res.status === 200 && res.data && res.data.success === true) {
    fail('Cross-tenant write violation: wrong-tenant token updated the customer', {
      customerId: ctx.rlsCustomerId,
      status: res.status,
      data: res.data,
    });
  }

  // Verify the name was NOT changed
  const verifyRes = await client.get(`/customer/${ctx.rlsCustomerId}`);
  assertStatus(verifyRes, 200);
  assertSuccess(verifyRes);

  const returnedName = verifyRes.data && verifyRes.data.data && verifyRes.data.data.name;
  if (returnedName === 'CROSS_TENANT_WRITE') {
    fail('Cross-tenant update persisted: name was overwritten by wrong-tenant token', {
      customerId: ctx.rlsCustomerId,
      name: returnedName,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE ISOLATION
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — wrong-tenant token must not delete valid customer', async (ctx) => {
  const res = await wrongTenantClient.delete(`/customer/${ctx.rlsCustomerId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    fail('Cross-tenant delete violation: wrong-tenant token deleted the customer', {
      customerId: ctx.rlsCustomerId,
      status: res.status,
      data: res.data,
    });
  }

  // Verify the resource still exists under the correct tenant after the attack
  const verifyRes = await client.get(`/customer/${ctx.rlsCustomerId}`);
  assertStatus(verifyRes, 200);
  assertSuccess(verifyRes);
  assertField(verifyRes, 'id', ctx.rlsCustomerId);
});

// ═════════════════════════════════════════════════════════════════════════════
// IDEMPOTENT DELETE REMAINS TENANT-SAFE
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — idempotent DELETE must not allow cross-tenant delete', async (ctx) => {
  // Create a second owned customer specifically for this test so we can
  // delete it ourselves afterward without affecting the shared rlsCustomerId.
  const createRes = await client.post('/customer', {
    name:  'RLS Idempotent Delete Target',
    email: 'rls.idempotent.delete@example.com',
  });
  assertStatus(createRes, 200);
  const targetId = createRes.data.data.id;

  // Wrong-tenant attempts to delete — must not succeed
  const attackRes = await wrongTenantClient.delete(`/customer/${targetId}`);
  if (attackRes.status === 200 && attackRes.data && attackRes.data.success === true) {
    fail('Cross-tenant idempotent-delete violation: wrong-tenant token deleted the resource', {
      targetId,
      status: attackRes.status,
      data: attackRes.data,
    });
  }

  // Correct tenant must still be able to delete the resource (proves it still exists)
  const ownDelete = await client.delete(`/customer/${targetId}`);
  assertStatus(ownDelete, 200);
  assertSuccess(ownDelete);
});

// ═════════════════════════════════════════════════════════════════════════════
// TENANT INJECTION VIA BODY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — tenant_id in POST body must be ignored or overwritten by gateway', async (ctx) => {
  const res = await client.post('/customer', {
    name:      'Tenant Injection POST Test',
    email:     'rls.inject.post@example.com',
    tenant_id: 'evil-tenant-id-rls-99999',
  });

  if (res.status === 200) {
    assertSuccess(res);
    const createdId = res.data.data.id;
    ctx.rlsTenantInjectionId = createdId;

    // The created record must be readable by the correct tenant
    const readRes = await client.get(`/customer/${createdId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    // The record must NOT belong to the injected evil tenant
    const returnedData = readRes.data.data;
    if (returnedData.tenant_id && returnedData.tenant_id === 'evil-tenant-id-rls-99999') {
      fail('Tenant injection succeeded: spoofed tenant_id in POST body was persisted', {
        returned_tenant_id: returnedData.tenant_id,
        createdId,
      });
    }

    // The wrong-tenant client must not be able to read the newly created record
    const crossReadRes = await wrongTenantClient.get(`/customer/${createdId}`);
    if (crossReadRes.status === 200 && crossReadRes.data && crossReadRes.data.success === true) {
      fail('Tenant injection allowed wrong-tenant read of the injected record', {
        createdId,
        status: crossReadRes.status,
      });
    }
  }
  // 400 is acceptable — gateway may reject unrecognised body fields outright
});

suite.test('RLS — tenant_id in PUT body must be ignored or overwritten by gateway', async (ctx) => {
  const res = await client.put(`/customer/${ctx.rlsCustomerId}`, {
    name:      'Tenant Injection PUT Test',
    tenant_id: 'evil-tenant-id-rls-put',
  });

  if (res.status === 200) {
    assertSuccess(res);

    // The record must still be accessible by the original tenant
    const readRes = await client.get(`/customer/${ctx.rlsCustomerId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    const returnedData = readRes.data.data;
    if (returnedData.tenant_id && returnedData.tenant_id === 'evil-tenant-id-rls-put') {
      fail('Tenant injection via PUT succeeded: spoofed tenant_id was persisted', {
        returned_tenant_id: returnedData.tenant_id,
        customerId: ctx.rlsCustomerId,
      });
    }
  }
  // 400 is acceptable — gateway may reject the injected field
});

// ═════════════════════════════════════════════════════════════════════════════
// EXTRA BODY FIELDS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — extra body fields must not bypass persistence rules', async (ctx) => {
  const res = await client.post('/customer', {
    name:          'RLS Extra Fields Test',
    email:         'rls.extra.fields@example.com',
    role:          'admin',
    is_admin:      true,
    injectedField: 'RLS_INJECTED',
  });

  if (res.status === 200) {
    assertSuccess(res);
    const createdId = res.data.data.id;
    ctx.rlsExtraFieldsId = createdId;

    const readRes = await client.get(`/customer/${createdId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    const data = readRes.data.data;
    const unexpectedFields = ['role', 'is_admin', 'injectedField'].filter((f) => f in data);
    if (unexpectedFields.length > 0) {
      fail('Extra body fields were persisted — possible schema or RLS bypass', {
        unexpectedFields,
        returnedData: data,
      });
    }
  }
  // 400 is acceptable — gateway may reject unknown fields
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS cleanup — tenant-injection POST customer', async (ctx) => {
  if (!ctx.rlsTenantInjectionId) return;
  const res = await client.delete(`/customer/${ctx.rlsTenantInjectionId}`);
  assertStatus(res, 200);
});

suite.test('RLS cleanup — extra-fields customer', async (ctx) => {
  if (!ctx.rlsExtraFieldsId) return;
  const res = await client.delete(`/customer/${ctx.rlsExtraFieldsId}`);
  assertStatus(res, 200);
});

suite.test('RLS cleanup — owned customer (setup resource)', async (ctx) => {
  if (!ctx.rlsCustomerId) return;
  const res = await client.delete(`/customer/${ctx.rlsCustomerId}`);
  assertStatus(res, 200);
});

// ── Export for run-tests.js ───────────────────────────────────────────────────
module.exports = suite;
