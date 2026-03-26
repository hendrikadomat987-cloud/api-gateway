'use strict';

/**
 * Appointments CRUD test suite
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
const VALID_CUSTOMER_ID  = '00000000-0000-0000-0000-000000000001'; // must exist in DB for your tenant
const FUTURE_DATETIME    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 1 week from now

const VALID_APPOINTMENT = {
  customer_id:      VALID_CUSTOMER_ID,
  scheduled_at:     FUTURE_DATETIME,
  duration_minutes: 30,
  status:           'scheduled',
  notes:            'Initial consultation',
};

const suite = createSuite('Appointments CRUD');

// ═════════════════════════════════════════════════════════════════════════════
// SUCCESS CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Create appointment — success', async (ctx) => {
  const res = await client.post('/appointments', VALID_APPOINTMENT);

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id']);

  ctx.appointmentId = res.data.data.id;
}, { critical: true });

suite.test('List appointments — success', async (ctx) => {
  const res = await client.get('/appointments');

  assertStatus(res, 200);
  assertSuccess(res);

  const data = res.data.data;
  if (!Array.isArray(data)) {
    const { fail } = require('../../core/assertions');
    fail('Expected data to be an array for list response', { data });
  }
});

suite.test('Get appointment by ID — success', async (ctx) => {
  const res = await client.get(`/appointments/${ctx.appointmentId}`);

  assertStatus(res, 200);
  assertSuccess(res);
  assertSchema(res, ['id', 'scheduled_at', 'status']);
  assertField(res, 'id', ctx.appointmentId);
});

suite.test('Update appointment (full update) — success', async (ctx) => {
  const newTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const res = await client.put(`/appointments/${ctx.appointmentId}`, {
    scheduled_at:     newTime,
    duration_minutes: 60,
    status:           'confirmed',
    notes:            'Rescheduled',
  });

  assertStatus(res, 200);
  assertSuccess(res);
});

suite.test('Update appointment (partial — status only) — success', async (ctx) => {
  const res = await client.put(`/appointments/${ctx.appointmentId}`, {
    status: 'confirmed',
  });

  assertStatus(res, 200);
  assertSuccess(res);
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('POST appointment — missing scheduled_at → VALIDATION_ERROR', async () => {
  const res = await client.post('/appointments', {
    customer_id: VALID_CUSTOMER_ID,
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST appointment — invalid scheduled_at → VALIDATION_ERROR', async () => {
  const res = await client.post('/appointments', {
    customer_id:  VALID_CUSTOMER_ID,
    scheduled_at: 'not-a-date',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST appointment — missing customer_id → VALIDATION_ERROR', async () => {
  const res = await client.post('/appointments', {
    scheduled_at: FUTURE_DATETIME,
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST appointment — invalid customer_id UUID → VALIDATION_ERROR', async () => {
  const res = await client.post('/appointments', {
    customer_id:  'not-a-uuid',
    scheduled_at: FUTURE_DATETIME,
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST appointment — invalid status → VALIDATION_ERROR', async () => {
  const res = await client.post('/appointments', {
    customer_id:  VALID_CUSTOMER_ID,
    scheduled_at: FUTURE_DATETIME,
    status:       'unknown_status',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('POST appointment — duration_minutes out of range → VALIDATION_ERROR', async () => {
  const res = await client.post('/appointments', {
    customer_id:      VALID_CUSTOMER_ID,
    scheduled_at:     FUTURE_DATETIME,
    duration_minutes: 9999,
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT appointment — empty body → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/appointments/${ctx.appointmentId}`, {});

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

suite.test('PUT appointment — invalid status → VALIDATION_ERROR', async (ctx) => {
  const res = await client.put(`/appointments/${ctx.appointmentId}`, {
    status: 'unknown_status',
  });

  assertStatus(res, 400);
  assertError(res, 'VALIDATION_ERROR');
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH TESTS
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET appointment — missing token → 401', async (ctx) => {
  const res = await noAuthClient.get(`/appointments/${ctx.appointmentId}`);
  assertStatus(res, 401);
});

suite.test('GET appointment — invalid token → 401', async (ctx) => {
  const res = await invalidAuthClient.get(`/appointments/${ctx.appointmentId}`);
  assertStatus(res, 401);
});

suite.test('GET appointment — expired token → 401', async (ctx) => {
  const res = await expiredAuthClient.get(`/appointments/${ctx.appointmentId}`);
  assertStatus(res, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TENANT SECURITY
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET appointment — wrong tenant → must not return data', async (ctx) => {
  const res = await wrongTenantClient.get(`/appointments/${ctx.appointmentId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant data leak: wrong-tenant token received the resource', {
      appointmentId: ctx.appointmentId,
      status: res.status,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('DELETE appointment — invalid UUID → INVALID_ID', async () => {
  const res = await client.delete('/appointments/not-a-valid-uuid');

  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('DELETE appointment — already deleted → idempotent success', async () => {
  const createRes = await client.post('/appointments', {
    customer_id:  VALID_CUSTOMER_ID,
    scheduled_at: FUTURE_DATETIME,
    status:       'scheduled',
  });
  assertStatus(createRes, 200);
  const tempId = createRes.data.data.id;

  const first  = await client.delete(`/appointments/${tempId}`);
  assertStatus(first, 200);
  assertSuccess(first);

  const second = await client.delete(`/appointments/${tempId}`);
  assertStatus(second, 200);
  assertSuccess(second);
  assertField(second, 'deleted', true);
});

// ═════════════════════════════════════════════════════════════════════════════
// GET EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

suite.test('GET appointment — invalid UUID → INVALID_ID', async () => {
  const res = await client.get('/appointments/not-a-valid-uuid');

  assertStatus(res, 400);
  assertError(res, 'INVALID_ID');
});

suite.test('GET appointment — non-existing UUID → 404 or empty', async () => {
  const NON_EXISTING = '00000000-0000-0000-0000-000000000000';
  const res = await client.get(`/appointments/${NON_EXISTING}`);

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
  const res = await client.post('/appointments', {
    customer_id:  VALID_CUSTOMER_ID,
    scheduled_at: FUTURE_DATETIME,
    tenant_id:    'evil-tenant-id-99999',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.tenantInjectionId = res.data.data.id;

    const readRes = await client.get(`/appointments/${ctx.tenantInjectionId}`);
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
  const res = await client.post('/appointments', {
    customer_id:   VALID_CUSTOMER_ID,
    scheduled_at:  FUTURE_DATETIME,
    role:          'admin',
    injectedField: 'INJECTED_VALUE',
  });

  if (res.status === 200) {
    assertSuccess(res);
    ctx.bodyInjectionId = res.data.data.id;

    const readRes = await client.get(`/appointments/${ctx.bodyInjectionId}`);
    assertStatus(readRes, 200);
    const data = readRes.data.data;
    const injectedFields = ['role', 'injectedField'].filter((f) => f in data);
    if (injectedFields.length > 0) {
      const { fail } = require('../../core/assertions');
      fail('Unexpected fields were persisted in the appointment record', {
        injectedFields,
        returnedData: data,
      });
    }
  }
});

suite.test('Security — cross-tenant: wrong-tenant must not update appointment', async (ctx) => {
  const res = await wrongTenantClient.put(`/appointments/${ctx.appointmentId}`, {
    status: 'cancelled',
  });

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant write violation: wrong-tenant token updated the appointment', {
      appointmentId: ctx.appointmentId,
    });
  }
});

suite.test('Security — cross-tenant: wrong-tenant must not delete appointment', async (ctx) => {
  const res = await wrongTenantClient.delete(`/appointments/${ctx.appointmentId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('Cross-tenant delete violation: wrong-tenant token deleted the appointment', {
      appointmentId: ctx.appointmentId,
    });
  }

  if (res.status !== 200) {
    const verifyRes = await client.get(`/appointments/${ctx.appointmentId}`);
    assertStatus(verifyRes, 200);
    assertSuccess(verifyRes);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — tenant-injection appointment', async (ctx) => {
  if (!ctx.tenantInjectionId) return;
  await client.delete(`/appointments/${ctx.tenantInjectionId}`);
});

suite.test('Cleanup — body-injection appointment', async (ctx) => {
  if (!ctx.bodyInjectionId) return;
  await client.delete(`/appointments/${ctx.bodyInjectionId}`);
});

suite.test('Delete appointment — cleanup', async (ctx) => {
  if (!ctx.appointmentId) return;

  const res = await client.delete(`/appointments/${ctx.appointmentId}`);

  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
