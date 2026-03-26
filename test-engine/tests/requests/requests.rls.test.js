'use strict';

/**
 * Requests — Row-Level Security (RLS) Test Suite
 *
 * Verifies that PostgreSQL RLS policies prevent cross-tenant data access
 * even when requests bypass the gateway and hit the DB layer directly.
 *
 * IMPORTANT: These tests target the API (gateway + n8n + DB) to confirm
 * end-to-end RLS enforcement. They do NOT connect to PostgreSQL directly.
 *
 * Test strategy:
 * - Tenant A creates records via /requests
 * - Tenant B (wrongTenantClient) attempts to read / modify / delete them
 * - Every cross-tenant attempt must result in 401, 403, 404, or an empty result
 * - A 200 response containing Tenant A's data is a RLS violation
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createSuite }  = require('../../core/testRunner');
const { createClient } = require('../../core/apiClient');
const {
  assertStatus,
  assertSuccess,
} = require('../../core/assertions');
const config = require('../../config');

const tenantA = createClient({ token: config.tokens.valid });
const tenantB = createClient({ token: config.tokens.wrongTenant });

const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

const suite = createSuite('Requests — RLS');

// ═════════════════════════════════════════════════════════════════════════════
// SETUP — Tenant A creates a record
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Setup — Tenant A creates a request', async (ctx) => {
  const res = await tenantA.post('/requests', {
    customer_id: VALID_CUSTOMER_ID,
    type:        'support',
    status:      'pending',
    notes:       'RLS test record',
  });

  assertStatus(res, 200);
  assertSuccess(res);

  ctx.rlsRequestId = res.data.data.id;
}, { critical: true });

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Cross-tenant GET
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant B cannot read Tenant A request by ID', async (ctx) => {
  const res = await tenantB.get(`/requests/${ctx.rlsRequestId}`);

  if (res.status === 200 && res.data && res.data.success === true && res.data.data && res.data.data.id) {
    const { fail } = require('../../core/assertions');
    fail('RLS VIOLATION: Tenant B retrieved Tenant A request', {
      rlsRequestId: ctx.rlsRequestId,
      returnedId:   res.data.data.id,
    });
  }
  // 401, 403, 404 are all valid RLS-enforced outcomes
});

suite.test('RLS — Tenant B list does not include Tenant A records', async (ctx) => {
  const res = await tenantB.get('/requests');

  if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
    const leaked = res.data.data.find((r) => r.id === ctx.rlsRequestId);
    if (leaked) {
      const { fail } = require('../../core/assertions');
      fail('RLS VIOLATION: Tenant B list contains Tenant A request', {
        rlsRequestId: ctx.rlsRequestId,
        leaked,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Cross-tenant UPDATE
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant B cannot update Tenant A request', async (ctx) => {
  const res = await tenantB.put(`/requests/${ctx.rlsRequestId}`, {
    status: 'closed',
  });

  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('RLS VIOLATION: Tenant B updated Tenant A request', {
      rlsRequestId: ctx.rlsRequestId,
    });
  }

  // Confirm Tenant A record is unchanged
  const verifyRes = await tenantA.get(`/requests/${ctx.rlsRequestId}`);
  if (verifyRes.status === 200 && verifyRes.data && verifyRes.data.data) {
    const r = verifyRes.data.data;
    if (r.status === 'closed') {
      const { fail } = require('../../core/assertions');
      fail('RLS VIOLATION: Tenant A record status was changed by Tenant B', {
        rlsRequestId: ctx.rlsRequestId,
        status:       r.status,
      });
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Cross-tenant DELETE
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant B cannot delete Tenant A request', async (ctx) => {
  const res = await tenantB.delete(`/requests/${ctx.rlsRequestId}`);

  if (res.status === 200 && res.data && res.data.success === true) {
    // Idempotent delete returns success — confirm record still exists for Tenant A
    const verifyRes = await tenantA.get(`/requests/${ctx.rlsRequestId}`);
    if (verifyRes.status !== 200 || !verifyRes.data || !verifyRes.data.data || !verifyRes.data.data.id) {
      const { fail } = require('../../core/assertions');
      fail('RLS VIOLATION: Tenant B deleted Tenant A request — record no longer accessible', {
        rlsRequestId: ctx.rlsRequestId,
      });
    }
  }
  // 401, 403, 404 are all valid RLS-enforced outcomes
});

// ═════════════════════════════════════════════════════════════════════════════
// RLS: Verify Tenant A still owns their record after all cross-tenant attempts
// ═════════════════════════════════════════════════════════════════════════════

suite.test('RLS — Tenant A record is intact after all cross-tenant attempts', async (ctx) => {
  const res = await tenantA.get(`/requests/${ctx.rlsRequestId}`);

  assertStatus(res, 200);
  assertSuccess(res);

  const data = res.data.data;
  if (!data || data.id !== ctx.rlsRequestId) {
    const { fail } = require('../../core/assertions');
    fail('Tenant A request was tampered with or deleted during RLS tests', {
      rlsRequestId: ctx.rlsRequestId,
      data,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═════════════════════════════════════════════════════════════════════════════

suite.test('Cleanup — RLS test request', async (ctx) => {
  if (!ctx.rlsRequestId) return;

  const res = await tenantA.delete(`/requests/${ctx.rlsRequestId}`);
  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
