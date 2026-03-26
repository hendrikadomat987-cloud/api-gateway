'use strict';

/**
 * Resources — Row-Level Security (RLS) Test Suite
 *
 * Verifies PostgreSQL RLS policies prevent cross-tenant data access end-to-end.
 * Does NOT connect to PostgreSQL directly — tests via API only.
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

const suite = createSuite('Resources — RLS');

suite.test('Setup — Tenant A creates a resource', async (ctx) => {
  const res = await tenantA.post('/resources', {
    name:    'RLS Test Resource',
    type:    'document',
    content: 'Confidential content for Tenant A only.',
    status:  'active',
  });
  assertStatus(res, 200);
  assertSuccess(res);
  ctx.rlsResourceId = res.data.data.id;
}, { critical: true });

suite.test('RLS — Tenant B cannot read Tenant A resource by ID', async (ctx) => {
  const res = await tenantB.get(`/resources/${ctx.rlsResourceId}`);
  if (res.status === 200 && res.data && res.data.success === true && res.data.data && res.data.data.id) {
    const { fail } = require('../../core/assertions');
    fail('RLS VIOLATION: Tenant B retrieved Tenant A resource', {
      rlsResourceId: ctx.rlsResourceId,
      returnedId:    res.data.data.id,
    });
  }
});

suite.test('RLS — Tenant B list does not include Tenant A records', async (ctx) => {
  const res = await tenantB.get('/resources');
  if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
    const leaked = res.data.data.find((r) => r.id === ctx.rlsResourceId);
    if (leaked) {
      const { fail } = require('../../core/assertions');
      fail('RLS VIOLATION: Tenant B list contains Tenant A resource', { rlsResourceId: ctx.rlsResourceId });
    }
  }
});

suite.test('RLS — Tenant B cannot update Tenant A resource', async (ctx) => {
  const res = await tenantB.put(`/resources/${ctx.rlsResourceId}`, { status: 'archived' });
  if (res.status === 200 && res.data && res.data.success === true) {
    const { fail } = require('../../core/assertions');
    fail('RLS VIOLATION: Tenant B updated Tenant A resource', { rlsResourceId: ctx.rlsResourceId });
  }
  const verifyRes = await tenantA.get(`/resources/${ctx.rlsResourceId}`);
  if (verifyRes.status === 200 && verifyRes.data && verifyRes.data.data) {
    if (verifyRes.data.data.status === 'archived') {
      const { fail } = require('../../core/assertions');
      fail('RLS VIOLATION: Tenant A resource status changed by Tenant B', { rlsResourceId: ctx.rlsResourceId });
    }
  }
});

suite.test('RLS — Tenant B cannot delete Tenant A resource', async (ctx) => {
  const res = await tenantB.delete(`/resources/${ctx.rlsResourceId}`);
  if (res.status === 200 && res.data && res.data.success === true) {
    const verifyRes = await tenantA.get(`/resources/${ctx.rlsResourceId}`);
    if (verifyRes.status !== 200 || !verifyRes.data || !verifyRes.data.data || !verifyRes.data.data.id) {
      const { fail } = require('../../core/assertions');
      fail('RLS VIOLATION: Tenant B deleted Tenant A resource', { rlsResourceId: ctx.rlsResourceId });
    }
  }
});

suite.test('RLS — Tenant A record intact after all cross-tenant attempts', async (ctx) => {
  const res = await tenantA.get(`/resources/${ctx.rlsResourceId}`);
  assertStatus(res, 200);
  assertSuccess(res);
  const data = res.data.data;
  if (!data || data.id !== ctx.rlsResourceId) {
    const { fail } = require('../../core/assertions');
    fail('Tenant A resource was tampered with or deleted', { rlsResourceId: ctx.rlsResourceId, data });
  }
});

suite.test('Cleanup — RLS test resource', async (ctx) => {
  if (!ctx.rlsResourceId) return;
  const res = await tenantA.delete(`/resources/${ctx.rlsResourceId}`);
  assertStatus(res, 200);
  assertSuccess(res);
});

module.exports = suite;
