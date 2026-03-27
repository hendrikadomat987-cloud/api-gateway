'use strict';

/**
 * Availability — CRUD Test Suite
 *
 * Pattern: Arrange → Act → Assert → Cleanup
 * Shared ctx carries IDs across tests within the suite run.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createSuite }  = require('../test-engine/core/testRunner');
const { createClient } = require('../test-engine/core/apiClient');
const {
  assertStatus,
  assertSuccess,
  assertError,
  assertSchema,
  assertField,
} = require('../test-engine/core/assertions');
const config = require('../test-engine/config');

const client            = createClient({ token: config.tokens.valid });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });
const wrongTenantClient = createClient({ token: config.tokens.wrongTenant });

const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

const VALID_AVAILABILITY = {
  customer_id: VALID_CUSTOMER_ID,
  day_of_week: 1,
  start_time:  '09:00',
  end_time:    '17:00',
  status:      'active',
};

const suite = createSuite('Availability CRUD');

// ═════════════════════════════════════════════════════════════════════════════
// SUCCESS CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Create availability — success', async (ctx) => {
  const res = await client.post('/availability', VALID_AVAILABILITY);
  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);
  ctx.availabilityId = res.data.data.id;
}, { critical: true });

suite.test('List availability — success', async () => {
  const res = await client.get('/availability');
  assertStatus(res, 200);
  assertSuccess(res);
  const data = res.data.data;
  if (!Array.isArray(data)) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Expected data to be an array for list response', { data });
  }
});

suite.test('Get availability by ID — success', async (ctx) => {
  const res = await client.get(`/availability/${ctx.availabilityId}`);
  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id', 'day_of_week', 'start_time', 'end_time', 'status']);
  assertField(res, 'id', ctx.availabilityId);
});

suite.test('Update availability (full update) — success', async (ctx) => {
  const res = await client.put(`/availability/${ctx.availabilityId}`, {
    day_of_week: 3,
    start_time:  '10:00',
    end_time:    '18:00',
    status:      'inactive',
  });
  assertStatus(res, 200);
  assertSuccess(res);
});

suite.test('Update availability (partial — status only) — success', async (ctx) => {
  const res = await client.put(`/availability/${ctx.availabilityId}`, { status: 'active' });
  assertStatus(res, 200);
  assertSuccess(res);
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('POST — missing customer_id → VALIDATION_ERROR', async () => {
  const res = await client.post('/availability', { day_of_week: 1, start_time: '09:00', end_time: '17:00' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid customer_id UUID → VALIDATION_ERROR', async () => {
  const res = await client.post('/availability', { customer_id: 'not-a-uuid', day_of_week: 1, start_time: '09:00', end_time: '17:00' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — missing day_of_week → VALIDATION_ERROR', async () => {
  const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, start_time: '09:00', end_time: '17:00' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid day_of_week (out of range) → VALIDATION_ERROR', async () => {
  const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, day_of_week: 7, start_time: '09:00', end_time: '17:00' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — missing start_time → VALIDATION_ERROR', async () => {
  const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, day_of_week: 1, end_time: '17:00' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid start_time format → VALIDATION_ERROR', async () => {
  const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, day_of_week: 1, start_time: '9am', end_time: '17:00' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid status → VALIDATION_ERROR', async () => {
  const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, day_of_week: 1, start_time: '09:00', end_time: '17:00', status: 'unknown' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — empty body → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/availability/${ctx.availabilityId}`, {});
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — invalid status → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/availability/${ctx.availabilityId}`, { status: 'unknown_status' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET — missing token → 401', async (ctx) => {
  const res = await noAuthClient.get(`/availability/${ctx.availabilityId}`);
  assertStatus(res, 401);
});

suite.test('GET — invalid token → 401', async (ctx) => {
  const res = await invalidAuthClient.get(`/availability/${ctx.availabilityId}`);
  assertStatus(res, 401);
});

suite.test('GET — expired token → 401', async (ctx) => {
  const res = await expiredAuthClient.get(`/availability/${ctx.availabilityId}`);
  assertStatus(res, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TENANT SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET — wrong tenant must not return data', async (ctx) => {
  const res = await wrongTenantClient.get(`/availability/${ctx.availabilityId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Cross-tenant data leak detected', { availabilityId: ctx.availabilityId });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('DELETE — invalid UUID → INVALID_ID', async () => {
  const res = await client.delete('/availability/not-a-valid-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE — already deleted → idempotent success', async () => {
  const createRes = await client.post('/availability', {
    customer_id: VALID_CUSTOMER_ID,
    day_of_week: 5,
    start_time:  '08:00',
    end_time:    '12:00',
  });
  assertStatus(createRes, 200);
  const tempId = createRes.data.data.id;

  const first = await client.delete(`/availability/${tempId}`);
  assertStatus(first, 200);
  assertSuccess(first);

  const second = await client.delete(`/availability/${tempId}`);
  assertStatus(second, 200);
  assertSuccess(second);
  assertField(second, 'deleted', true);
});

suite.test('GET — invalid UUID → INVALID_ID', async () => {
  const res = await client.get('/availability/not-a-valid-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET — non-existing UUID → 404 or empty', async () => {
  const res = await client.get('/availability/00000000-0000-0000-0000-000000000000');
  if (res.status === 404) {
    assertError(res, 'NOT_FOUND');
  } else if (res.status === 200) {
    const data = res.data && res.data.data;
    if (data && data.id) {
      const { fail } = require('../test-engine/core/assertions');
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
  const res = await client.post('/availability', {
    customer_id: VALID_CUSTOMER_ID,
    day_of_week: 2,
    start_time:  '11:00',
    end_time:    '15:00',
    tenant_id:   'evil-tenant-id-99999',
  });
  if (res.status === 200) {
    assertSuccess(res);
    ctx.tenantInjectionId = res.data.data.id;
    const readRes = await client.get(`/availability/${ctx.tenantInjectionId}`);
    assertStatus(readRes, 200);
    const returnedData = readRes.data.data;
    if (returnedData && returnedData.tenant_id === 'evil-tenant-id-99999') {
      const { fail } = require('../test-engine/core/assertions');
      fail('Tenant injection succeeded', { returned_tenant_id: returnedData.tenant_id });
    }
  }
});

suite.test('Security — extra body fields must not be persisted', async (ctx) => {
  const res = await client.post('/availability', {
    customer_id:   VALID_CUSTOMER_ID,
    day_of_week:   4,
    start_time:    '13:00',
    end_time:      '16:00',
    role:          'admin',
    injectedField: 'INJECTED',
  });
  if (res.status === 200) {
    assertSuccess(res);
    ctx.bodyInjectionId = res.data.data.id;
    const readRes = await client.get(`/availability/${ctx.bodyInjectionId}`);
    assertStatus(readRes, 200);
    const data = readRes.data.data;
    const injected = ['role', 'injectedField'].filter((f) => f in data);
    if (injected.length > 0) {
      const { fail } = require('../test-engine/core/assertions');
      fail('Unexpected fields persisted', { injected, data });
    }
  }
});

suite.test('Security — wrong-tenant must not update availability', async (ctx) => {
  const res = await wrongTenantClient.put(`/availability/${ctx.availabilityId}`, { status: 'blocked' });
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Cross-tenant write violation', { availabilityId: ctx.availabilityId });
  }
});

suite.test('Security — wrong-tenant must not delete availability', async (ctx) => {
  const res = await wrongTenantClient.delete(`/availability/${ctx.availabilityId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Cross-tenant delete violation', { availabilityId: ctx.availabilityId });
  }
  if (res.status !== 200) {
    const verifyRes = await client.get(`/availability/${ctx.availabilityId}`);
    assertStatus(verifyRes, 200);
    assertSuccess(verifyRes);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — tenant-injection record', async (ctx) => {
  if (!ctx.tenantInjectionId) return;
  await client.delete(`/availability/${ctx.tenantInjectionId}`);
});

suite.test('Cleanup — body-injection record', async (ctx) => {
  if (!ctx.bodyInjectionId) return;
  await client.delete(`/availability/${ctx.bodyInjectionId}`);
});

suite.test('Delete availability — cleanup', async (ctx) => {
  if (!ctx.availabilityId) return;
  const res = await client.delete(`/availability/${ctx.availabilityId}`);
  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
