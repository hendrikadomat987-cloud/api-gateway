'use strict';

/**
 * Customer Gateway Security test suite
 *
 * Verifies that the API Gateway enforces Zero-Trust tenant isolation:
 *   - JWT organization_id is the ONLY authoritative source for tenant_id
 *   - tenant_id in request body is ignored / overwritten by the gateway
 *   - tenant_id in query string is ignored / overwritten by the gateway
 *   - All customer operations work without any client-supplied tenant_id
 *   - Manipulated tenant values in body/query cannot widen or redirect access
 *
 * These tests act as regression guards for the gateway hardening layer.
 * A passing test means the gateway correctly enforced JWT-only tenant resolution.
 * A failing test means a tenant isolation regression has been introduced.
 *
 * Pattern: Arrange → Attack/Access → Assert → Verify → Cleanup
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
const suite = createSuite('Customer Gateway Security');

// ═════════════════════════════════════════════════════════════════════════════
// SETUP  —  create a customer owned by the valid JWT tenant
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GW-SEC setup — create owned customer for gateway security tests', async (ctx) => {
  // Intentionally send NO tenant_id — gateway must derive it from JWT alone
  const res = await client.post('/customer', {
    name:  'Gateway Security Target',
    email: 'gw.security.target@example.com',
    phone: '+49000000099',
  });

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);

  ctx.gwCustomerId = res.data.data.id;
}, { critical: true });

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — API works without any client-supplied tenant_id
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GW-SEC — GET all customers works without tenant_id in query', async (ctx) => {
  // No ?tenant_id= in the query — gateway must resolve tenant from JWT
  const res = await client.get('/customer');

  assertStatus(res, 200);
  assertSuccess(res);
  // The response must contain data (at minimum the customer we just created)
  const data = res.data && res.data.data;
  if (data === null || data === undefined) {
    fail('GET all returned no data object — expected array or object', { body: res.data });
  }
});

suite.test('GW-SEC — GET by ID works without tenant_id in query', async (ctx) => {
  // No ?tenant_id= in the query — gateway derives tenant from JWT
  const res = await client.get(`/customer/${ctx.gwCustomerId}`);

  assertStatus(res, 200);
  assertSuccess(res);
  assertField(res, 'id', ctx.gwCustomerId);
});

suite.test('GW-SEC — PUT works without tenant_id in body', async (ctx) => {
  // Only send the update fields — no tenant_id in body
  const res = await client.put(`/customer/${ctx.gwCustomerId}`, {
    name: 'Gateway Security Updated',
  });

  assertStatus(res, 200);
  assertSuccess(res);

  // Verify the update was applied under the correct JWT tenant
  const verifyRes = await client.get(`/customer/${ctx.gwCustomerId}`);
  assertStatus(verifyRes, 200);
  assertField(verifyRes, 'id', ctx.gwCustomerId);
});

suite.test('GW-SEC — DELETE works without tenant_id in body or query', async (ctx) => {
  // Create a disposable customer, then delete it without sending any tenant_id
  const createRes = await client.post('/customer', {
    name:  'GW-SEC Disposable',
    email: 'gw.sec.disposable@example.com',
  });
  assertStatus(createRes, 200);
  const disposableId = createRes.data.data.id;

  const deleteRes = await client.delete(`/customer/${disposableId}`);
  assertStatus(deleteRes, 200);
  assertSuccess(deleteRes);
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Body tenant_id injection must be ignored or overwritten
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GW-SEC — POST with forged body tenant_id must not create under foreign tenant', async (ctx) => {
  // JWT belongs to Tenant A; body carries a forged Tenant B tenant_id
  const res = await client.post('/customer', {
    name:      'Forged Tenant POST',
    email:     'gw.forged.post@example.com',
    tenant_id: 'forged-tenant-b-0000-0000-000000000000',
  });

  if (res.status === 200) {
    assertSuccess(res);
    const createdId = res.data.data.id;
    ctx.gwForgedPostId = createdId;

    // The created record must be readable by the correct JWT tenant
    const readRes = await client.get(`/customer/${createdId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    // The record must NOT carry the forged tenant value
    const returnedData = readRes.data.data;
    if (
      returnedData.tenant_id &&
      returnedData.tenant_id === 'forged-tenant-b-0000-0000-000000000000'
    ) {
      fail('Body tenant_id injection succeeded: forged tenant_id was persisted on POST', {
        createdId,
        returned_tenant_id: returnedData.tenant_id,
      });
    }

    // The wrong-tenant client must NOT be able to read the record
    const crossReadRes = await wrongTenantClient.get(`/customer/${createdId}`);
    if (crossReadRes.status === 200 && crossReadRes.data && crossReadRes.data.success === true) {
      fail('Forged POST tenant allowed wrong-tenant to read the created record', {
        createdId,
        status: crossReadRes.status,
      });
    }
  }
  // 400 is acceptable — gateway may reject the forged field outright
});

suite.test('GW-SEC — PUT with forged body tenant_id must not update under foreign tenant', async (ctx) => {
  const res = await client.put(`/customer/${ctx.gwCustomerId}`, {
    name:      'Forged Tenant PUT',
    tenant_id: 'forged-tenant-b-0000-0000-000000000000',
  });

  if (res.status === 200) {
    assertSuccess(res);

    // Record must still be accessible by the correct JWT tenant
    const verifyRes = await client.get(`/customer/${ctx.gwCustomerId}`);
    assertStatus(verifyRes, 200);
    assertSuccess(verifyRes);

    // The stored tenant_id must not have been overwritten with the forged value
    const data = verifyRes.data.data;
    if (data.tenant_id && data.tenant_id === 'forged-tenant-b-0000-0000-000000000000') {
      fail('Body tenant_id injection succeeded: forged tenant_id was persisted on PUT', {
        customerId: ctx.gwCustomerId,
        returned_tenant_id: data.tenant_id,
      });
    }
  }
  // 400 is acceptable — gateway may reject the unknown field
});

suite.test('GW-SEC — POST with extra privilege fields must not persist them', async (ctx) => {
  // Extra fields like role, is_admin must be stripped by the gateway
  const res = await client.post('/customer', {
    name:          'GW Extra Fields Test',
    email:         'gw.extra.fields@example.com',
    role:          'superadmin',
    is_admin:      true,
    injectedField: 'GATEWAY_INJECTED',
    tenant_id:     'forged-tenant-extra-fields',
  });

  if (res.status === 200) {
    assertSuccess(res);
    const createdId = res.data.data.id;
    ctx.gwExtraFieldsId = createdId;

    const readRes = await client.get(`/customer/${createdId}`);
    assertStatus(readRes, 200);
    assertSuccess(readRes);

    const data = readRes.data.data;

    // Extra fields must not appear in the stored record
    const unexpectedFields = ['role', 'is_admin', 'injectedField'].filter((f) => f in data);
    if (unexpectedFields.length > 0) {
      fail('Extra body fields were persisted through the gateway', {
        unexpectedFields,
        returnedData: data,
      });
    }

    // Forged tenant must not have been stored
    if (data.tenant_id && data.tenant_id === 'forged-tenant-extra-fields') {
      fail('Forged tenant_id from extra-fields POST was persisted', {
        returned_tenant_id: data.tenant_id,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Query tenant_id must not widen or redirect access
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GW-SEC — GET with forged query tenant_id must not read foreign tenant data', async (ctx) => {
  // Attempt to read all customers while injecting a foreign tenant_id via query.
  // The gateway must ignore or override the query tenant and use the JWT tenant.
  const res = await client.get('/customer', {
    params: { tenant_id: 'forged-tenant-query-0000-000000000000' },
  });

  // 400 is acceptable if the gateway rejects the query param outright.
  // 200 is acceptable only if the response contains exclusively JWT-tenant data.
  if (res.status === 200 && res.data && res.data.success === true) {
    // Cannot prove the data belongs to the forged tenant without cross-referencing,
    // but we can assert the owned customer IS present (JWT tenant data returned correctly)
    const data = res.data.data;
    const items = Array.isArray(data) ? data : (data ? [data] : []);

    // If the response is non-empty and none of the items is our owned customer,
    // that suggests the query tenant redirect succeeded — flag it.
    if (items.length > 0) {
      const ownedItemFound = items.some((item) => item.id === ctx.gwCustomerId);
      if (!ownedItemFound) {
        fail(
          'GET with forged query tenant_id returned data that does not include the JWT-tenant customer — possible tenant redirect',
          {
            gwCustomerId: ctx.gwCustomerId,
            itemCount:    items.length,
            firstId:      items[0] && items[0].id,
          }
        );
      }
    }
  }
  // 400 / 422 are also acceptable — gateway may reject the param
});

suite.test('GW-SEC — GET by ID with forged query tenant_id still resolves correctly', async (ctx) => {
  // Attach a forged tenant_id as a query param; the gateway must use JWT tenant
  const res = await client.get(`/customer/${ctx.gwCustomerId}`, {
    params: { tenant_id: 'forged-tenant-query-getid-000000000000' },
  });

  // Three acceptable outcomes:
  // 1. 200 + correct record  → gateway used JWT tenant, query param ignored ✅
  // 2. 400                   → gateway rejected the unexpected query param ✅
  // 3. Anything else         → needs investigation

  if (res.status === 200) {
    assertSuccess(res);
    // The returned record must be ours (JWT-tenant data, not forged-tenant data)
    assertField(res, 'id', ctx.gwCustomerId);
  } else if (res.status !== 400 && res.status !== 404) {
    fail(`Unexpected status ${res.status} when querying with forged tenant_id param`, {
      body: res.data,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — DELETE tenant isolation with manipulated inputs
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GW-SEC — DELETE with forged body tenant_id uses JWT tenant, not body', async (ctx) => {
  // Create a disposable customer, then delete it while sending a forged body tenant_id.
  // The gateway must ignore the body tenant and use the JWT tenant — the delete must
  // succeed because the JWT tenant actually owns the record.
  const createRes = await client.post('/customer', {
    name:  'GW-SEC Forged Delete Target',
    email: 'gw.sec.forged.delete@example.com',
  });
  assertStatus(createRes, 200);
  const targetId = createRes.data.data.id;

  const deleteRes = await client.delete(`/customer/${targetId}`, {
    data: { tenant_id: 'forged-tenant-delete-body-000000000000' },
  });

  // The delete must succeed — JWT tenant owns the record, body tenant is irrelevant
  assertStatus(deleteRes, 200);
  assertSuccess(deleteRes);
});

suite.test('GW-SEC — wrong-tenant DELETE with forged body tenant_id must not delete JWT-tenant resource', async (ctx) => {
  // wrong-tenant client attempts to delete an owned resource and also sends the
  // correct tenant_id in the body, hoping the gateway uses the body value.
  // The gateway must use the JWT tenant (wrong tenant), not the body tenant.
  const attackRes = await wrongTenantClient.delete(`/customer/${ctx.gwCustomerId}`, {
    data: { tenant_id: String(config.tokens.valid).substring(0, 36) },
  });

  if (attackRes.status === 200 && attackRes.data && attackRes.data.success === true) {
    fail(
      'Body tenant_id injection on DELETE succeeded: wrong-tenant deleted a JWT-tenant resource',
      {
        customerId: ctx.gwCustomerId,
        status:     attackRes.status,
      }
    );
  }

  // Verify the resource still exists under the correct JWT tenant
  const verifyRes = await client.get(`/customer/${ctx.gwCustomerId}`);
  assertStatus(verifyRes, 200);
  assertSuccess(verifyRes);
  assertField(verifyRes, 'id', ctx.gwCustomerId);
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GW-SEC cleanup — forged-POST customer', async (ctx) => {
  if (!ctx.gwForgedPostId) return;
  const res = await client.delete(`/customer/${ctx.gwForgedPostId}`);
  assertStatus(res, 200);
});

suite.test('GW-SEC cleanup — extra-fields customer', async (ctx) => {
  if (!ctx.gwExtraFieldsId) return;
  const res = await client.delete(`/customer/${ctx.gwExtraFieldsId}`);
  assertStatus(res, 200);
});

suite.test('GW-SEC cleanup — owned setup customer', async (ctx) => {
  if (!ctx.gwCustomerId) return;
  const res = await client.delete(`/customer/${ctx.gwCustomerId}`);
  assertStatus(res, 200);
});

// ── Export for run-tests.js ───────────────────────────────────────────────────
module.exports = suite;
