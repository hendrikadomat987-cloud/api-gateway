'use strict';

/**
 * Customers — Row-Level Security (RLS) Test Suite
 *
 * Verifies tenant isolation end-to-end:
 *  - Tenant B cannot read, update, or delete resources owned by Tenant A
 *  - A 200 response that leaks Tenant A's data is a hard failure
 */

const { createClient }   = require('../../core/apiClient');
const { TestContext }     = require('../../core/context');
const { cleanupContext }  = require('../../core/cleanup');
const { customerFactory } = require('../../core/factories');
const {
  expectSuccess,
  expectNoDataLeak,
} = require('../../core/assertions');
const config = require('../../config/config');

const tenantA = createClient({ token: config.tokens.tenantA });
const tenantB = createClient({ token: config.tokens.tenantB });

const ctx = new TestContext();
let ownedId;

beforeAll(async () => {
  const res = await tenantA.post('/customer', customerFactory());
  const data = expectSuccess(res);
  ownedId = data.id;
  ctx.register('customers', ownedId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer RLS — Cross-tenant GET', () => {
  it('Tenant B cannot read Tenant A customer by ID', async () => {
    const res = await tenantB.get(`/customer/${ownedId}`);
    expectNoDataLeak(res, ownedId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer RLS — Cross-tenant PUT', () => {
  it('Tenant B cannot update Tenant A customer', async () => {
    const res = await tenantB.put(`/customer/${ownedId}`, { name: 'HIJACKED' });
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant A record is unmodified after cross-tenant update attempt', async () => {
    const res  = await tenantA.get(`/customer/${ownedId}`);
    const data = expectSuccess(res);

    // If name was changed by Tenant B, this would catch it
    expect(data.name).not.toBe('HIJACKED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer RLS — Cross-tenant DELETE', () => {
  it('Tenant B cannot delete Tenant A customer', async () => {
    const res = await tenantB.delete(`/customer/${ownedId}`);

    // If the delete appeared to succeed, Tenant A must still own the record
    if (res.status === 200 && res.data?.success === true) {
      const verifyRes = await tenantA.get(`/customer/${ownedId}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data?.data?.id).toBe(ownedId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer RLS — Post-attack integrity', () => {
  it('Tenant A record is intact after all cross-tenant attempts', async () => {
    const res  = await tenantA.get(`/customer/${ownedId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(ownedId);
  });
});
