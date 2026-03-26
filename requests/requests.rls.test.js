'use strict';

/**
 * Requests — Row-Level Security (RLS) Test Suite
 *
 * Verifies PostgreSQL RLS policies prevent cross-tenant data access end-to-end.
 * Does NOT connect to PostgreSQL directly — tests via API only.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createSuite }  = require('../test-engine/core/testRunner');
const { createClient } = require('../test-engine/core/apiClient');
const {
  assertStatus,
  assertSuccess,
} = require('../test-engine/core/assertions');
const config = require('../test-engine/config');

const tenantA = createClient({ token: config.tokens.valid });
const tenantB = createClient({ token: config.tokens.wrongTenant });

const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

const suite = createSuite('Requests — RLS');

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

suite.test('RLS — Tenant B cannot read Tenant A request by ID', async (ctx) => {
  const res = await tenantB.get(`/requests/${ctx.rlsRequestId}`);
  if (res.status === 200 && res.data && res.data.success === true && res.data.data && res.data.data.id) {
    const { fail } = require('../test-engine/core/assertions');
    fail('RLS VIOLATION: Tenant B retrieved Tenant A request', {
      rlsRequestId: ctx.rlsRequestId,
      returnedId:   res.data.data.id,
    });
  }
});

suite.test('RLS — Tenant B list does not include Tenant A records', async (ctx) => {
  const res = await tenantB.get('/requests');
  if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
    const leaked = res.data.data.find((r) => r.id === ctx.rlsRequestId);
    if (leaked) {
      const { fail } = require('../test-engine/core/assertions');
      fail('RLS VIOLATION: Tenant B list contains Tenant A request', { rlsRequestId: ctx.rlsRequestId });
    }
  }
});

suite.test('RLS — Tenant B cannot update Tenant A request', async (ctx) => {
  const res = await tenantB.put(`/requests/${ctx.rlsRequestId}`, { status: 'closed' });
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../test-engine/core/assertions');
    fail('RLS VIOLATION: Tenant B updated Tenant A request', { rlsRequestId: ctx.rlsRequestId });
  }
  const verifyRes = await tenantA.get(`/requests/${ctx.rlsRequestId}`);
  if (verifyRes.status === 200 && verifyRes.data && verifyRes.data.data) {
    if (verifyRes.data.data.status === 'closed') {
      const { fail } = require('../test-engine/core/assertions');
      fail('RLS VIOLATION: Tenant A record status changed by Tenant B', { rlsRequestId: ctx.rlsRequestId });
    }
  }
});

suite.test('RLS — Tenant B cannot delete Tenant A request', async (ctx) => {
  const res = await tenantB.delete(`/requests/${ctx.rlsRequestId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const verifyRes = await tenantA.get(`/requests/${ctx.rlsRequestId}`);
    if (verifyRes.status !== 200 || !verifyRes.data || !verifyRes.data.data || !verifyRes.data.data.id) {
      const { fail } = require('../test-engine/core/assertions');
      fail('RLS VIOLATION: Tenant B deleted Tenant A request', { rlsRequestId: ctx.rlsRequestId });
    }
  }
});

suite.test('RLS — Tenant A record intact after all cross-tenant attempts', async (ctx) => {
  const res = await tenantA.get(`/requests/${ctx.rlsRequestId}`);
  assertStatus(res, 200);
  assertSuccess(res);
  const data = res.data.data;
  if (!data || data.id !== ctx.rlsRequestId) {
    const { fail } = require('../test-engine/core/assertions');
    fail('Tenant A request was tampered with or deleted', { rlsRequestId: ctx.rlsRequestId, data });
  }
});

suite.test('Cleanup — RLS test request', async (ctx) => {
  if (!ctx.rlsRequestId) return;
  const res = await tenantA.delete(`/requests/${ctx.rlsRequestId}`);
  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
