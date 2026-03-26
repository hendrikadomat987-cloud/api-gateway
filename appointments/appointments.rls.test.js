'use strict';

/**
 * Appointments — Row-Level Security (RLS) Test Suite
 *
 * Verifies that PostgreSQL RLS policies prevent cross-tenant data access
 * even when requests bypass the gateway and hit the DB layer directly.
 *
 * IMPORTANT: These tests target the API (gateway + n8n + DB) to confirm
 * end-to-end RLS enforcement. They do NOT connect to PostgreSQL directly.
 *
 * Test strategy:
 * - Tenant A creates records via /appointments
 * - Tenant B (wrongTenantClient) attempts to read / modify / delete them
 * - Every cross-tenant attempt must result in 401, 403, 404, or an empty result
 * - A 200 response containing Tenant A's data is a RLS violation
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createSuite }  = require('../../test-engine/core/testRunner');
const { createClient } = require('../../test-engine/core/apiClient');
const {
  assertStatus,
  assertSuccess,
} = require('../../test-engine/core/assertions');
const config = require('../../test-engine/config');

const tenantA = createClient({ token: config.tokens.valid });
const tenantB = createClient({ token: config.tokens.wrongTenant });

const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';
const FUTURE_DATETIME   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const suite = createSuite('Appointments — RLS');

// ═════════════════════════════════════════════════════════════════════════════
// SETUP — Tenant A creates a record
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Setup — Tenant A creates an appointment', async (ctx) => {
  const res = await tenantA.post('/appointments', {
    customer_id:      VALID_CUSTOMER_ID,
    scheduled_at:     FUTURE_DATETIME,
    duration_minutes: 45,
    status:           'scheduled',
    notes:            'RLS test record',
  });

  assertStatus(res, 200);
  assertSuccess(res);

  ctx.rlsAppointmentId = res.data.data.id;
}, { critical: true });

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Cross-tenant GET
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant B cannot read Tenant A appointment by ID', async (ctx) => {
  const res = await tenantB.get(`/appointments/${ctx.rlsAppointmentId}`);

  if (res.status === 200 && res.data && res.data.success === true && res.data.data && res.data.data.id) {
    const { fail } = require('../../test-engine/core/assertions');
    fail('RLS VIOLATION: Tenant B retrieved Tenant A appointment', {
      rlsAppointmentId: ctx.rlsAppointmentId,
      returnedId:       res.data.data.id,
    });
  }
});

suite.test('RLS — Tenant B list does not include Tenant A records', async (ctx) => {
  const res = await tenantB.get('/appointments');

  if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
    const leaked = res.data.data.find((a) => a.id === ctx.rlsAppointmentId);
    if (leaked) {
      const { fail } = require('../../test-engine/core/assertions');
      fail('RLS VIOLATION: Tenant B list contains Tenant A appointment', {
        rlsAppointmentId: ctx.rlsAppointmentId,
        leaked,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Cross-tenant UPDATE
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant B cannot update Tenant A appointment', async (ctx) => {
  const res = await tenantB.put(`/appointments/${ctx.rlsAppointmentId}`, {
    status: 'cancelled',
  });

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../test-engine/core/assertions');
    fail('RLS VIOLATION: Tenant B updated Tenant A appointment', {
      rlsAppointmentId: ctx.rlsAppointmentId,
    });
  }

  // Confirm Tenant A record is unchanged
  const verifyRes = await tenantA.get(`/appointments/${ctx.rlsAppointmentId}`);
  if (verifyRes.status === 200 && verifyRes.data && verifyRes.data.data) {
    const a = verifyRes.data.data;
    if (a.status === 'cancelled') {
      const { fail } = require('../../test-engine/core/assertions');
      fail('RLS VIOLATION: Tenant A appointment status was changed by Tenant B', {
        rlsAppointmentId: ctx.rlsAppointmentId,
        status:           a.status,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Cross-tenant DELETE
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant B cannot delete Tenant A appointment', async (ctx) => {
  const res = await tenantB.delete(`/appointments/${ctx.rlsAppointmentId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    // Idempotent delete returns success — confirm record still exists for Tenant A
    const verifyRes = await tenantA.get(`/appointments/${ctx.rlsAppointmentId}`);
    if (verifyRes.status !== 200 || !verifyRes.data || !verifyRes.data.data || !verifyRes.data.data.id) {
      const { fail } = require('../../test-engine/core/assertions');
      fail('RLS VIOLATION: Tenant B deleted Tenant A appointment — record no longer accessible', {
        rlsAppointmentId: ctx.rlsAppointmentId,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Verify Tenant A still owns their record after all cross-tenant attempts
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant A record is intact after all cross-tenant attempts', async (ctx) => {
  const res = await tenantA.get(`/appointments/${ctx.rlsAppointmentId}`);

  assertStatus(res, 200);
  assertSuccess(res);

  const data = res.data.data;
  if (!data || data.id !== ctx.rlsAppointmentId) {
    const { fail } = require('../../test-engine/core/assertions');
    fail('Tenant A appointment was tampered with or deleted during RLS tests', {
      rlsAppointmentId: ctx.rlsAppointmentId,
      data,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — RLS test appointment', async (ctx) => {
  if (!ctx.rlsAppointmentId) return;

  const res = await tenantA.delete(`/appointments/${ctx.rlsAppointmentId}`);
  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
