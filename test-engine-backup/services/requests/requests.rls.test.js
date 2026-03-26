'use strict';

/**
 * Requests — Row-Level Security (RLS) Test Suite
 *
 * Tenant B attempts every mutation and read on Tenant A's request.
 * Any 200 response that returns Tenant A's data is a hard RLS violation.
 */

const { createClient }                   = require('../../core/apiClient');
const { TestContext }                     = require('../../core/context');
const { cleanupContext }                  = require('../../core/cleanup');
const { customerFactory, requestFactory } = require('../../core/factories');
const {
  expectSuccess,
  expectNoDataLeak,
} = require('../../core/assertions');
const config = require('../../config/config');

const tenantA = createClient({ token: config.tokens.tenantA });
const tenantB = createClient({ token: config.tokens.tenantB });

const ctx = new TestContext();
let customerId;
let requestId;

beforeAll(async () => {
  const custRes = await tenantA.post('/customer', customerFactory());
  customerId    = expectSuccess(custRes).id;
  ctx.register('customers', customerId);

  const reqRes = await tenantA.post('/requests', requestFactory(customerId));
  requestId    = expectSuccess(reqRes).id;
  ctx.register('requests', requestId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Requests RLS — Cross-tenant GET', () => {
  it('Tenant B cannot read Tenant A request by ID', async () => {
    const res = await tenantB.get(`/requests/${requestId}`);
    expectNoDataLeak(res, requestId);
  });

  it('Tenant B list does not contain Tenant A request', async () => {
    const res = await tenantB.get('/requests');
    if (res.status === 200 && Array.isArray(res.data?.data)) {
      const leaked = res.data.data.find((r) => r.id === requestId);
      expect(leaked).toBeUndefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Requests RLS — Cross-tenant PUT', () => {
  it('Tenant B cannot update Tenant A request', async () => {
    const res = await tenantB.put(`/requests/${requestId}`, { status: 'closed' });
    expectNoDataLeak(res, requestId);
  });

  it('Tenant A status is unchanged after cross-tenant update attempt', async () => {
    const res  = await tenantA.get(`/requests/${requestId}`);
    const data = expectSuccess(res);
    // Initial status from factory was 'pending' — it must not have been changed to 'closed'
    expect(data.status).not.toBe('closed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Requests RLS — Cross-tenant DELETE', () => {
  it('Tenant B cannot delete Tenant A request', async () => {
    const res = await tenantB.delete(`/requests/${requestId}`);

    if (res.status === 200 && res.data?.success === true) {
      // Idempotent delete may return 200 — verify record still exists for Tenant A
      const verify = await tenantA.get(`/requests/${requestId}`);
      expect(verify.status).toBe(200);
      expect(verify.data?.data?.id).toBe(requestId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Requests RLS — Post-attack integrity', () => {
  it('Tenant A request is intact after all cross-tenant attempts', async () => {
    const res  = await tenantA.get(`/requests/${requestId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(requestId);
  });
});
