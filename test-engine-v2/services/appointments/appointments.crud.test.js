'use strict';

/**
 * Appointments — CRUD Test Suite
 *
 * Tests the full create/read/update/delete lifecycle for the /appointments endpoint.
 * All resources created here are cleaned up in afterAll.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 * FIXTURE:       Customer 00000000-0000-0000-0000-000000000001 must exist in DB.
 */

const { createClient }       = require('../../core/apiClient');
const { TestContext }         = require('../../core/context');
const { cleanupContext }      = require('../../core/cleanup');
const { appointmentFactory }  = require('../../core/factories');
const {
  expectSuccess,
  expectValidationError,
  expectUnauthorized,
  expectInvalidId,
  expectNoDataLeak,
  expectUuid,
} = require('../../core/assertions');
const config = require('../../config/config');

// ── Clients ───────────────────────────────────────────────────────────────────
const client            = createClient({ token: config.tokens.tenantA });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });
const tenantB           = createClient({ token: config.tokens.tenantB });

// ── Context & fixtures ────────────────────────────────────────────────────────
const ctx = new TestContext();

// Customer fixture that must exist in the DB for the test tenant
const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Create', () => {
  it('creates an appointment with all required fields', async () => {
    const payload = appointmentFactory(VALID_CUSTOMER_ID);
    const res     = await client.post('/appointments', payload);
    const data    = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('appointments', data.id);
    ctx.set('primaryId', data.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Read', () => {
  it('lists appointments', async () => {
    const res  = await client.get('/appointments');
    const data = expectSuccess(res);
    expect(Array.isArray(data)).toBe(true);
  });

  it('retrieves an existing appointment by ID', async () => {
    const id   = ctx.get('primaryId');
    const res  = await client.get(`/appointments/${id}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(id);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.get('/appointments/not-a-valid-uuid'));
  });

  it('returns 404 or empty data for a non-existent UUID', async () => {
    const NON_EXISTING = '00000000-0000-0000-0000-000000000000';
    const res          = await client.get(`/appointments/${NON_EXISTING}`);

    if (res.status === 404) {
      expect(res.data.success).toBe(false);
    } else {
      expect(res.status).toBe(200);
      const data = res.data?.data;
      expect(!data || !data.id).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Update', () => {
  it('full update (all writable fields)', async () => {
    const id      = ctx.get('primaryId');
    const newTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const res     = await client.put(`/appointments/${id}`, {
      scheduled_at:     newTime,
      duration_minutes: 60,
      status:           'confirmed',
      notes:            'Rescheduled',
    });
    expectSuccess(res);
  });

  it('partial update (status only)', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.put(`/appointments/${id}`, { status: 'confirmed' });
    expectSuccess(res);
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.put(`/appointments/${id}`, {});
    expectValidationError(res);
  });

  it('rejects invalid status in update → VALIDATION_ERROR', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.put(`/appointments/${id}`, { status: 'unknown_status' });
    expectValidationError(res);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.put('/appointments/not-a-uuid', { status: 'confirmed' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Validation', () => {
  it('rejects missing scheduled_at → VALIDATION_ERROR', async () => {
    const res = await client.post('/appointments', { customer_id: VALID_CUSTOMER_ID });
    expectValidationError(res);
  });

  it('rejects invalid scheduled_at → VALIDATION_ERROR', async () => {
    const res = await client.post('/appointments', {
      customer_id:  VALID_CUSTOMER_ID,
      scheduled_at: 'not-a-date',
    });
    expectValidationError(res);
  });

  it('rejects missing customer_id → VALIDATION_ERROR', async () => {
    const payload = appointmentFactory(VALID_CUSTOMER_ID);
    delete payload.customer_id;
    const res = await client.post('/appointments', payload);
    expectValidationError(res);
  });

  it('rejects invalid customer_id (not a UUID) → VALIDATION_ERROR', async () => {
    const res = await client.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID, { customer_id: 'not-a-uuid' }));
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID, { status: 'unknown_status' }));
    expectValidationError(res);
  });

  it('rejects duration_minutes out of range → VALIDATION_ERROR', async () => {
    const res = await client.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID, { duration_minutes: 9999 }));
    expectValidationError(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Delete', () => {
  it('deletes an existing appointment', async () => {
    const res  = await client.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID));
    const data = expectSuccess(res);
    const id   = data.id;

    const delRes = await client.delete(`/appointments/${id}`);
    expectSuccess(delRes);
    // already deleted — no cleanup registration needed
  });

  it('is idempotent — deleting twice returns success with deleted:true', async () => {
    const res  = await client.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID));
    const id   = expectSuccess(res).id;

    await client.delete(`/appointments/${id}`);
    const second = await client.delete(`/appointments/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.delete('/appointments/not-a-valid-uuid'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Auth enforcement', () => {
  it('no token on GET → 401', async () => {
    const res = await noAuthClient.get(`/appointments/${ctx.get('primaryId')}`);
    expectUnauthorized(res);
  });

  it('invalid token on GET → 401', async () => {
    const res = await invalidAuthClient.get(`/appointments/${ctx.get('primaryId')}`);
    expectUnauthorized(res);
  });

  it('expired token on GET → 401', async () => {
    const res = await expiredAuthClient.get(`/appointments/${ctx.get('primaryId')}`);
    expectUnauthorized(res);
  });

  it('no token on PUT → 401', async () => {
    const res = await noAuthClient.put(`/appointments/${ctx.get('primaryId')}`, { status: 'confirmed' });
    expectUnauthorized(res);
  });

  it('no token on DELETE → 401', async () => {
    const res = await noAuthClient.delete(`/appointments/${ctx.get('primaryId')}`);
    expectUnauthorized(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECURITY
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Security', () => {
  it('tenant_id in body is ignored — JWT tenant wins', async () => {
    const payload = { ...appointmentFactory(VALID_CUSTOMER_ID), tenant_id: 'evil-tenant-id-99999' };
    const res     = await client.post('/appointments', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('appointments', data.id);

      const readRes  = await client.get(`/appointments/${data.id}`);
      const readData = expectSuccess(readRes);
      if (readData.tenant_id) {
        expect(readData.tenant_id).not.toBe('evil-tenant-id-99999');
      }
    }
  });

  it('extra body fields are not persisted', async () => {
    const payload = { ...appointmentFactory(VALID_CUSTOMER_ID), role: 'admin', injectedField: 'INJECTED_VALUE' };
    const res     = await client.post('/appointments', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('appointments', data.id);

      const readRes  = await client.get(`/appointments/${data.id}`);
      const readData = expectSuccess(readRes);
      expect(readData).not.toHaveProperty('injectedField');
    }
  });

  it('cross-tenant: tenantB must not read Tenant A appointment', async () => {
    const id  = ctx.get('primaryId');
    const res = await tenantB.get(`/appointments/${id}`);
    expectNoDataLeak(res, id);
  });

  it('cross-tenant: tenantB must not update Tenant A appointment', async () => {
    const id  = ctx.get('primaryId');
    const res = await tenantB.put(`/appointments/${id}`, { status: 'cancelled' });
    expectNoDataLeak(res, id);
  });

  it('cross-tenant: tenantB must not delete Tenant A appointment', async () => {
    const id  = ctx.get('primaryId');
    const res = await tenantB.delete(`/appointments/${id}`);

    // If delete appeared to succeed, Tenant A must still own the record
    if (res.status === 200 && res.data?.success === true) {
      const verifyRes = await client.get(`/appointments/${id}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data?.data?.id).toBe(id);
    }
  });
});
