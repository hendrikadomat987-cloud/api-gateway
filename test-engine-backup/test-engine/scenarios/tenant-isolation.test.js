'use strict';

/**
 * Scenario: Tenant Isolation
 *
 * A comprehensive cross-service tenant isolation test.
 *
 * Tenant A creates one of each resource type.
 * Tenant B then attempts EVERY read / write / delete on those resources.
 *
 * Any successful 200 response that returns Tenant A's data is
 * logged as a hard test failure (data leak).
 *
 * This test complements the per-service RLS suites by covering
 * the combination of services in a single scenario run.
 */

const { createClient }                                = require('../core/apiClient');
const { TestContext }                                  = require('../core/context');
const { cleanupContext }                               = require('../core/cleanup');
const { customerFactory, requestFactory, resourceFactory } = require('../core/factories');
const {
  expectSuccess,
  expectNoDataLeak,
} = require('../core/assertions');
const config = require('../config/config');

const tenantA = createClient({ token: config.tokens.tenantA });
const tenantB = createClient({ token: config.tokens.tenantB });

const ctx = new TestContext();

// IDs owned by Tenant A
let customerId;
let requestId;
let resourceId;

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Tenant A creates all resources
  const custRes = await tenantA.post('/customer', customerFactory());
  customerId    = expectSuccess(custRes).id;
  ctx.register('customers', customerId);

  const reqRes = await tenantA.post('/requests', requestFactory(customerId));
  requestId    = expectSuccess(reqRes).id;
  ctx.register('requests', requestId);

  const resRes = await tenantA.post('/resources', resourceFactory());
  resourceId   = expectSuccess(resRes).id;
  ctx.register('resources', resourceId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOMER ISOLATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation — Customer', () => {
  it('Tenant B cannot read Tenant A customer', async () => {
    expectNoDataLeak(await tenantB.get(`/customer/${customerId}`), customerId);
  });

  it('Tenant B cannot update Tenant A customer', async () => {
    const res = await tenantB.put(`/customer/${customerId}`, { name: 'STOLEN' });
    expectNoDataLeak(res, customerId);

    // Confirm Tenant A still owns unchanged record
    const verify = await tenantA.get(`/customer/${customerId}`);
    expectSuccess(verify);
    expect(verify.data.data.name).not.toBe('STOLEN');
  });

  it('Tenant B cannot delete Tenant A customer', async () => {
    const res = await tenantB.delete(`/customer/${customerId}`);
    if (res.status === 200 && res.data?.success === true) {
      const verify = await tenantA.get(`/customer/${customerId}`);
      expect(verify.data?.data?.id).toBe(customerId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// REQUEST ISOLATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation — Request', () => {
  it('Tenant B cannot read Tenant A request', async () => {
    expectNoDataLeak(await tenantB.get(`/requests/${requestId}`), requestId);
  });

  it('Tenant B list does not include Tenant A requests', async () => {
    const res = await tenantB.get('/requests');
    if (res.status === 200 && Array.isArray(res.data?.data)) {
      expect(res.data.data.find((r) => r.id === requestId)).toBeUndefined();
    }
  });

  it('Tenant B cannot update Tenant A request', async () => {
    const res = await tenantB.put(`/requests/${requestId}`, { status: 'closed' });
    expectNoDataLeak(res, requestId);

    const verify = await tenantA.get(`/requests/${requestId}`);
    if (verify.data?.data) {
      expect(verify.data.data.status).not.toBe('closed');
    }
  });

  it('Tenant B cannot delete Tenant A request', async () => {
    const res = await tenantB.delete(`/requests/${requestId}`);
    if (res.status === 200 && res.data?.success === true) {
      const verify = await tenantA.get(`/requests/${requestId}`);
      expect(verify.data?.data?.id).toBe(requestId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RESOURCE ISOLATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation — Resource', () => {
  it('Tenant B cannot read Tenant A resource', async () => {
    expectNoDataLeak(await tenantB.get(`/resources/${resourceId}`), resourceId);
  });

  it('Tenant B list does not include Tenant A resources', async () => {
    const res = await tenantB.get('/resources');
    if (res.status === 200 && Array.isArray(res.data?.data)) {
      expect(res.data.data.find((r) => r.id === resourceId)).toBeUndefined();
    }
  });

  it('Tenant B cannot update Tenant A resource', async () => {
    const res = await tenantB.put(`/resources/${resourceId}`, { name: 'STOLEN' });
    expectNoDataLeak(res, resourceId);

    const verify = await tenantA.get(`/resources/${resourceId}`);
    if (verify.data?.data) {
      expect(verify.data.data.name).not.toBe('STOLEN');
    }
  });

  it('Tenant B cannot delete Tenant A resource', async () => {
    const res = await tenantB.delete(`/resources/${resourceId}`);
    if (res.status === 200 && res.data?.success === true) {
      const verify = await tenantA.get(`/resources/${resourceId}`);
      expect(verify.data?.data?.id).toBe(resourceId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FINAL INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Tenant Isolation — Final integrity check', () => {
  it('All Tenant A resources are intact after all cross-tenant attempts', async () => {
    const [custRes, reqRes, resRes] = await Promise.all([
      tenantA.get(`/customer/${customerId}`),
      tenantA.get(`/requests/${requestId}`),
      tenantA.get(`/resources/${resourceId}`),
    ]);

    expect(custRes.data?.data?.id).toBe(customerId);
    expect(reqRes.data?.data?.id).toBe(requestId);
    expect(resRes.data?.data?.id).toBe(resourceId);
  });
});
