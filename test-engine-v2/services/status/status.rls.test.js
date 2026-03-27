'use strict';

/**
 * Status — Row-Level Security (RLS) Test Suite
 *
 * Verifies tenant isolation end-to-end:
 *  - Tenant B cannot read, update, or delete records owned by Tenant A
 *  - A 200 response that leaks Tenant A's data is a hard failure
 *
 * IMPORTANT: These tests target the API (gateway + n8n + DB) to confirm
 * end-to-end RLS enforcement. They do NOT connect to PostgreSQL directly.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createClient }  = require('../../core/apiClient');
const { TestContext }   = require('../../core/context');
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

const VALID_STATUS = {
  name:  'RLS Test Agent',
  type:  'agent',
  value: 'online',
};

let ownedId;

beforeAll(async () => {
  const res  = await tenantA.post('/status', VALID_STATUS);
  const data = expectSuccess(res);
  ownedId    = data.id;
  ctx.register('status', ownedId);
});

afterAll(async () => {
  if (ownedId) {
    await tenantA.delete(`/status/${ownedId}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Status RLS — Cross-tenant GET', () => {
  it('Tenant B cannot read Tenant A status by ID', async () => {
    const res = await tenantB.get(`/status/${ownedId}`);
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant B list does not include Tenant A records', async () => {
    const res = await tenantB.get('/status');

    if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
      const leaked = res.data.data.find((s) => s.id === ownedId);
      if (leaked) {
        throw new Error(
          `RLS VIOLATION: Tenant B list contains Tenant A status record ${ownedId}`
        );
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Status RLS — Cross-tenant PUT', () => {
  it('Tenant B cannot update Tenant A status', async () => {
    const res = await tenantB.put(`/status/${ownedId}`, { value: 'offline' });
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant A record is unmodified after cross-tenant update attempt', async () => {
    const res  = await tenantA.get(`/status/${ownedId}`);
    const data = expectSuccess(res);

    // If value was changed by Tenant B, this would catch it
    expect(data.value).not.toBe('offline');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Status RLS — Cross-tenant DELETE', () => {
  it('Tenant B cannot delete Tenant A status', async () => {
    const res = await tenantB.delete(`/status/${ownedId}`);

    // If the delete appeared to succeed, Tenant A must still own the record
    if (res.status === 200 && res.data?.success === true) {
      const verifyRes = await tenantA.get(`/status/${ownedId}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data?.data?.id).toBe(ownedId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Status RLS — Post-attack integrity', () => {
  it('Tenant A record is intact after all cross-tenant attempts', async () => {
    const res  = await tenantA.get(`/status/${ownedId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(ownedId);
  });
});
