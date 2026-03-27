'use strict';

/**
 * Knowledge — Row-Level Security (RLS) Test Suite
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

const VALID_KNOWLEDGE = {
  title:   'RLS Test Article',
  content: 'This article tests row-level security isolation.',
  status:  'draft',
};

let ownedId;

beforeAll(async () => {
  const res  = await tenantA.post('/knowledge', VALID_KNOWLEDGE);
  const data = expectSuccess(res);
  ownedId    = data.id;
  ctx.register('knowledge', ownedId);
});

afterAll(async () => {
  if (ownedId) {
    await tenantA.delete(`/knowledge/${ownedId}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge RLS — Cross-tenant GET', () => {
  it('Tenant B cannot read Tenant A knowledge by ID', async () => {
    const res = await tenantB.get(`/knowledge/${ownedId}`);
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant B list does not include Tenant A records', async () => {
    const res = await tenantB.get('/knowledge');

    if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
      const leaked = res.data.data.find((k) => k.id === ownedId);
      if (leaked) {
        throw new Error(
          `RLS VIOLATION: Tenant B list contains Tenant A knowledge record ${ownedId}`
        );
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge RLS — Cross-tenant PUT', () => {
  it('Tenant B cannot update Tenant A knowledge', async () => {
    const res = await tenantB.put(`/knowledge/${ownedId}`, { status: 'published' });
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant A record is unmodified after cross-tenant update attempt', async () => {
    const res  = await tenantA.get(`/knowledge/${ownedId}`);
    const data = expectSuccess(res);

    // If status was changed by Tenant B, this would catch it
    expect(data.status).not.toBe('published');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge RLS — Cross-tenant DELETE', () => {
  it('Tenant B cannot delete Tenant A knowledge', async () => {
    const res = await tenantB.delete(`/knowledge/${ownedId}`);

    // If the delete appeared to succeed, Tenant A must still own the record
    if (res.status === 200 && res.data?.success === true) {
      const verifyRes = await tenantA.get(`/knowledge/${ownedId}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data?.data?.id).toBe(ownedId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge RLS — Post-attack integrity', () => {
  it('Tenant A record is intact after all cross-tenant attempts', async () => {
    const res  = await tenantA.get(`/knowledge/${ownedId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(ownedId);
  });
});
