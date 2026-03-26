'use strict';

/**
 * Resources — CRUD Test Suite
 *
 * Pattern: Arrange → Act → Assert → Cleanup
 * Shared ctx carries IDs across tests within the suite run.
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

const client            = createClient({ token: config.tokens.valid });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });
const wrongTenantClient = createClient({ token: config.tokens.wrongTenant });

const VALID_RESOURCE = {
  name:    'Customer FAQ v1',
  type:    'faq',
  content: 'What are your opening hours? We are open Monday to Friday 9am-5pm.',
  status:  'active',
};

const suite = createSuite('Resources CRUD');

// ═════════════════════════════════════════════════════════════════════════════
// SUCCESS CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Create resource — success', async (ctx) => {
  const res = await client.post('/resources', VALID_RESOURCE);
  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);
  ctx.resourceId = res.data.data.id;
}, { critical: true });

suite.test('List resources — success', async () => {
  const res = await client.get('/resources');
  assertStatus(res, 200);
  assertSuccess(res);
  const data = res.data.data;
  if (!Array.isArray(data)) {
    const { fail } = require('../../core/assertions');
    fail('Expected data to be an array for list response', { data });
  }
});

suite.test('Get resource by ID — success', async (ctx) => {
  const res = await client.get(`/resources/${ctx.resourceId}`);
  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id', 'name', 'type', 'status']);
  assertField(res, 'id', ctx.resourceId);
});

suite.test('Update resource (full update) — success', async (ctx) => {
  const res = await client.put(`/resources/${ctx.resourceId}`, {
    name:    'Customer FAQ v2',
    type:    'document',
    content: 'Updated content',
    status:  'draft',
  });
  assertStatus(res, 200);
  assertSuccess(res);
});

suite.test('Update resource (partial — status only) — success', async (ctx) => {
  const res = await client.put(`/resources/${ctx.resourceId}`, { status: 'active' });
  assertStatus(res, 200);
  assertSuccess(res);
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('POST — missing name → VALIDATION_ERROR', async () => {
  const res = await client.post('/resources', { type: 'faq' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — missing type → VALIDATION_ERROR', async () => {
  const res = await client.post('/resources', { name: 'Test Resource' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid type → VALIDATION_ERROR', async () => {
  const res = await client.post('/resources', { name: 'Test Resource', type: 'invalid_type' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid status → VALIDATION_ERROR', async () => {
  const res = await client.post('/resources', { name: 'Test Resource', type: 'faq', status: 'invalid_status' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — empty body → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/resources/${ctx.resourceId}`, {});
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — invalid type → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/resources/${ctx.resourceId}`, { type: 'invalid_type' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — invalid status → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/resources/${ctx.resourceId}`, { status: 'invalid_status' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET — missing token → 401', async (ctx) => {
  const res = await noAuthClient.get(`/resources/${ctx.resourceId}`);
  assertStatus(res, 401);
});

suite.test('GET — invalid token → 401', async (ctx) => {
  const res = await invalidAuthClient.get(`/resources/${ctx.resourceId}`);
  assertStatus(res, 401);
});

suite.test('GET — expired token → 401', async (ctx) => {
  const res = await expiredAuthClient.get(`/resources/${ctx.resourceId}`);
  assertStatus(res, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TENANT SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET — wrong tenant must not return data', async (ctx) => {
  const res = await wrongTenantClient.get(`/resources/${ctx.resourceId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant data leak detected', { resourceId: ctx.resourceId });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('DELETE — invalid UUID → INVALID_ID', async () => {
  const res = await client.delete('/resources/not-a-valid-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE — already deleted → idempotent success', async () => {
  const createRes = await client.post('/resources', { name: 'Temp Resource', type: 'document' });
  assertStatus(createRes, 200);
  const tempId = createRes.data.data.id;

  const first = await client.delete(`/resources/${tempId}`);
  assertStatus(first, 200);
  assertSuccess(first);

  const second = await client.delete(`/resources/${tempId}`);
  assertStatus(second, 200);
  assertSuccess(second);
  assertField(second, 'deleted', true);
});

suite.test('GET — invalid UUID → INVALID_ID', async () => {
  const res = await client.get('/resources/not-a-valid-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET — non-existing UUID → 404 or empty', async () => {
  const res = await client.get('/resources/00000000-0000-0000-0000-000000000000');
  if (res.status === 404) {
    assertError(res, 'NOT_FOUND');
  } else if (res.status === 200) {
    const data = res.data && res.data.data;
    if (data && data.id) {
      const { fail } = require('../../core/assertions');
      fail('Expected empty for non-existing UUID but got a record', { data });
    }
  } else {
    assertStatus(res, 404);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SECURITY TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Security — tenant_id in body must be ignored', async (ctx) => {
  const res = await client.post('/resources', {
    name:      'Injection Test Resource',
    type:      'faq',
    tenant_id: 'evil-tenant-id-99999',
  });
  if (res.status === 200) {
    assertSuccess(res);
    ctx.tenantInjectionId = res.data.data.id;
    const readRes = await client.get(`/resources/${ctx.tenantInjectionId}`);
    assertStatus(readRes, 200);
    const returnedData = readRes.data.data;
    if (returnedData && returnedData.tenant_id === 'evil-tenant-id-99999') {
      const { fail } = require('../../core/assertions');
      fail('Tenant injection succeeded', { returned_tenant_id: returnedData.tenant_id });
    }
  }
});

suite.test('Security — extra body fields must not be persisted', async (ctx) => {
  const res = await client.post('/resources', {
    name:          'Extra Fields Test',
    type:          'template',
    role:          'admin',
    injectedField: 'INJECTED',
  });
  if (res.status === 200) {
    assertSuccess(res);
    ctx.bodyInjectionId = res.data.data.id;
    const readRes = await client.get(`/resources/${ctx.bodyInjectionId}`);
    assertStatus(readRes, 200);
    const data = readRes.data.data;
    const injected = ['role', 'injectedField'].filter((f) => f in data);
    if (injected.length > 0) {
      const { fail } = require('../../core/assertions');
      fail('Unexpected fields persisted', { injected, data });
    }
  }
});

suite.test('Security — wrong-tenant must not update resource', async (ctx) => {
  const res = await wrongTenantClient.put(`/resources/${ctx.resourceId}`, { status: 'archived' });
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant write violation', { resourceId: ctx.resourceId });
  }
});

suite.test('Security — wrong-tenant must not delete resource', async (ctx) => {
  const res = await wrongTenantClient.delete(`/resources/${ctx.resourceId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant delete violation', { resourceId: ctx.resourceId });
  }
  if (res.status !== 200) {
    const verifyRes = await client.get(`/resources/${ctx.resourceId}`);
    assertStatus(verifyRes, 200);
    assertSuccess(verifyRes);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — tenant-injection record', async (ctx) => {
  if (!ctx.tenantInjectionId) return;
  await client.delete(`/resources/${ctx.tenantInjectionId}`);
});

suite.test('Cleanup — body-injection record', async (ctx) => {
  if (!ctx.bodyInjectionId) return;
  await client.delete(`/resources/${ctx.bodyInjectionId}`);
});

suite.test('Delete resource — cleanup', async (ctx) => {
  if (!ctx.resourceId) return;
  const res = await client.delete(`/resources/${ctx.resourceId}`);
  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
