'use strict';

/**
 * Notifications — CRUD Test Suite
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

const VALID_NOTIFICATION = {
  customer_id: VALID_CUSTOMER_ID,
  channel:     'email',
  type:        'reminder',
  message:     'Your appointment is tomorrow at 10:00',
  status:      'pending',
};

const suite = createSuite('Notifications CRUD');

// ═════════════════════════════════════════════════════════════════════════════
// SUCCESS CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Create notification — success', async (ctx) => {
  const res = await client.post('/notifications', VALID_NOTIFICATION);
  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);
  ctx.notificationId = res.data.data.id;
}, { critical: true });

suite.test('List notifications — success', async () => {
  const res = await client.get('/notifications');
  assertStatus(res, 200);
  assertSuccess(res);
  const data = res.data.data;
  if (!Array.isArray(data)) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Expected data to be an array for list response', { data });
  }
});

suite.test('Get notification by ID — success', async (ctx) => {
  const res = await client.get(`/notifications/${ctx.notificationId}`);
  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id', 'channel', 'type', 'status']);
  assertField(res, 'id', ctx.notificationId);
});

suite.test('Update notification (full update) — success', async (ctx) => {
  const res = await client.put(`/notifications/${ctx.notificationId}`, {
    channel: 'sms',
    type:    'confirmation',
    message: 'Updated message',
    status:  'sent',
  });
  assertStatus(res, 200);
  assertSuccess(res);
});

suite.test('Update notification (partial — status only) — success', async (ctx) => {
  const res = await client.put(`/notifications/${ctx.notificationId}`, { status: 'failed' });
  assertStatus(res, 200);
  assertSuccess(res);
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('POST — missing customer_id → VALIDATION_ERROR', async () => {
  const res = await client.post('/notifications', { channel: 'email', type: 'reminder' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid customer_id UUID → VALIDATION_ERROR', async () => {
  const res = await client.post('/notifications', { customer_id: 'not-a-uuid', channel: 'email', type: 'reminder' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — missing channel → VALIDATION_ERROR', async () => {
  const res = await client.post('/notifications', { customer_id: VALID_CUSTOMER_ID, type: 'reminder' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid channel → VALIDATION_ERROR', async () => {
  const res = await client.post('/notifications', { customer_id: VALID_CUSTOMER_ID, channel: 'fax', type: 'reminder' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — missing type → VALIDATION_ERROR', async () => {
  const res = await client.post('/notifications', { customer_id: VALID_CUSTOMER_ID, channel: 'email' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid type → VALIDATION_ERROR', async () => {
  const res = await client.post('/notifications', { customer_id: VALID_CUSTOMER_ID, channel: 'email', type: 'unknown_type' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST — invalid status → VALIDATION_ERROR', async () => {
  const res = await client.post('/notifications', { customer_id: VALID_CUSTOMER_ID, channel: 'email', type: 'reminder', status: 'unknown' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — empty body → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/notifications/${ctx.notificationId}`, {});
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — invalid channel → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/notifications/${ctx.notificationId}`, { channel: 'carrier-pigeon' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT — invalid status → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/notifications/${ctx.notificationId}`, { status: 'delivered' });
  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET — missing token → 401', async (ctx) => {
  const res = await noAuthClient.get(`/notifications/${ctx.notificationId}`);
  assertStatus(res, 401);
});

suite.test('GET — invalid token → 401', async (ctx) => {
  const res = await invalidAuthClient.get(`/notifications/${ctx.notificationId}`);
  assertStatus(res, 401);
});

suite.test('GET — expired token → 401', async (ctx) => {
  const res = await expiredAuthClient.get(`/notifications/${ctx.notificationId}`);
  assertStatus(res, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TENANT SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET — wrong tenant must not return data', async (ctx) => {
  const res = await wrongTenantClient.get(`/notifications/${ctx.notificationId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Cross-tenant data leak detected', { notificationId: ctx.notificationId });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('DELETE — invalid UUID → INVALID_ID', async () => {
  const res = await client.delete('/notifications/not-a-valid-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE — already deleted → idempotent success', async () => {
  const createRes = await client.post('/notifications', {
    customer_id: VALID_CUSTOMER_ID,
    channel:     'push',
    type:        'update',
  });
  assertStatus(createRes, 200);
  const tempId = createRes.data.data.id;

  const first = await client.delete(`/notifications/${tempId}`);
  assertStatus(first, 200);
  assertSuccess(first);

  const second = await client.delete(`/notifications/${tempId}`);
  assertStatus(second, 200);
  assertSuccess(second);
  assertField(second, 'deleted', true);
});

suite.test('GET — invalid UUID → INVALID_ID', async () => {
  const res = await client.get('/notifications/not-a-valid-uuid');
  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET — non-existing UUID → 404 or empty', async () => {
  const res = await client.get('/notifications/00000000-0000-0000-0000-000000000000');
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
  const res = await client.post('/notifications', {
    customer_id: VALID_CUSTOMER_ID,
    channel:     'sms',
    type:        'cancellation',
    tenant_id:   'evil-tenant-id-99999',
  });
  if (res.status === 200) {
    assertSuccess(res);
    ctx.tenantInjectionId = res.data.data.id;
    const readRes = await client.get(`/notifications/${ctx.tenantInjectionId}`);
    assertStatus(readRes, 200);
    const returnedData = readRes.data.data;
    if (returnedData && returnedData.tenant_id === 'evil-tenant-id-99999') {
      const { fail } = require('../test-engine/core/assertions');
      fail('Tenant injection succeeded', { returned_tenant_id: returnedData.tenant_id });
    }
  }
});

suite.test('Security — extra body fields must not be persisted', async (ctx) => {
  const res = await client.post('/notifications', {
    customer_id:   VALID_CUSTOMER_ID,
    channel:       'email',
    type:          'update',
    role:          'admin',
    injectedField: 'INJECTED',
  });
  if (res.status === 200) {
    assertSuccess(res);
    ctx.bodyInjectionId = res.data.data.id;
    const readRes = await client.get(`/notifications/${ctx.bodyInjectionId}`);
    assertStatus(readRes, 200);
    const data = readRes.data.data;
    const injected = ['role', 'injectedField'].filter((f) => f in data);
    if (injected.length > 0) {
      const { fail } = require('../test-engine/core/assertions');
      fail('Unexpected fields persisted', { injected, data });
    }
  }
});

suite.test('Security — wrong-tenant must not update notification', async (ctx) => {
  const res = await wrongTenantClient.put(`/notifications/${ctx.notificationId}`, { status: 'sent' });
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Cross-tenant write violation', { notificationId: ctx.notificationId });
  }
});

suite.test('Security — wrong-tenant must not delete notification', async (ctx) => {
  const res = await wrongTenantClient.delete(`/notifications/${ctx.notificationId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Cross-tenant delete violation', { notificationId: ctx.notificationId });
  }
  if (res.status !== 200) {
    const verifyRes = await client.get(`/notifications/${ctx.notificationId}`);
    assertStatus(verifyRes, 200);
    assertSuccess(verifyRes);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — tenant-injection record', async (ctx) => {
  if (!ctx.tenantInjectionId) return;
  await client.delete(`/notifications/${ctx.tenantInjectionId}`);
});

suite.test('Cleanup — body-injection record', async (ctx) => {
  if (!ctx.bodyInjectionId) return;
  await client.delete(`/notifications/${ctx.bodyInjectionId}`);
});

suite.test('Delete notification — cleanup', async (ctx) => {
  if (!ctx.notificationId) return;
  const res = await client.delete(`/notifications/${ctx.notificationId}`);
  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
