'use strict';

/**
 * Appointments — Row-Level Security (RLS) Test Suite
 *
 * Verifies tenant isolation end-to-end:
 *  - Tenant B cannot read, update, or delete resources owned by Tenant A
 *  - A 200 response that leaks Tenant A's data is a hard failure
 *
 * IMPORTANT: These tests target the API (gateway + n8n + DB) to confirm
 * end-to-end RLS enforcement. They do NOT connect to PostgreSQL directly.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 * FIXTURE:       Customer 00000000-0000-0000-0000-000000000001 must exist in DB.
 */

const { createClient }      = require('../../core/apiClient');
const { TestContext }        = require('../../core/context');
const { cleanupContext }     = require('../../core/cleanup');
const { appointmentFactory } = require('../../core/factories');
const {
  expectSuccess,
  expectNoDataLeak,
} = require('../../core/assertions');
const config = require('../../config/config');

// ── Clients ───────────────────────────────────────────────────────────────────
const tenantA = createClient({ token: config.tokens.tenantA });
const tenantB = createClient({ token: config.tokens.tenantB });

// ── Context & fixtures ────────────────────────────────────────────────────────
const ctx = new TestContext();
const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

let ownedId;

beforeAll(async () => {
  const res = await tenantA.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID));
  const data = expectSuccess(res);
  ownedId = data.id;
  ctx.register('appointments', ownedId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment RLS — Cross-tenant GET', () => {
  it('Tenant B cannot read Tenant A appointment by ID', async () => {
    const res = await tenantB.get(`/appointments/${ownedId}`);
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant B list does not include Tenant A records', async () => {
    const res = await tenantB.get('/appointments');

    if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
      const leaked = res.data.data.find((a) => a.id === ownedId);
      if (leaked) {
        throw new Error(
          `RLS VIOLATION: Tenant B list contains Tenant A appointment ${ownedId}`
        );
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment RLS — Cross-tenant PUT', () => {
  it('Tenant B cannot update Tenant A appointment', async () => {
    const res = await tenantB.put(`/appointments/${ownedId}`, { status: 'cancelled' });
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant A record is unmodified after cross-tenant update attempt', async () => {
    const res  = await tenantA.get(`/appointments/${ownedId}`);
    const data = expectSuccess(res);

    // If status was changed by Tenant B, this would catch it
    expect(data.status).not.toBe('cancelled');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment RLS — Cross-tenant DELETE', () => {
  it('Tenant B cannot delete Tenant A appointment', async () => {
    const res = await tenantB.delete(`/appointments/${ownedId}`);

    // If the delete appeared to succeed, Tenant A must still own the record
    if (res.status === 200 && res.data?.success === true) {
      const verifyRes = await tenantA.get(`/appointments/${ownedId}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data?.data?.id).toBe(ownedId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment RLS — Post-attack integrity', () => {
  it('Tenant A record is intact after all cross-tenant attempts', async () => {
    const res  = await tenantA.get(`/appointments/${ownedId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(ownedId);
  });
});
