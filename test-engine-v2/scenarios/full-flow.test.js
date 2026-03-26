'use strict';

/**
 * Scenario: Full Business Flow
 *
 * Exercises the complete end-to-end lifecycle that a real user would trigger:
 *
 *   1. Create a customer
 *   2. Create a request for that customer
 *   3. Create a resource (independent document)
 *   4. Read and verify each resource
 *   5. Update the request status through its lifecycle
 *   6. Delete everything in reverse FK order
 *
 * This test exists to confirm that all services work together correctly —
 * not just in isolation.
 */

const { createClient }                                = require('../core/apiClient');
const { TestContext }                                  = require('../core/context');
const { cleanupContext }                               = require('../core/cleanup');
const { customerFactory, requestFactory, resourceFactory } = require('../core/factories');
const {
  expectSuccess,
  expectUuid,
} = require('../core/assertions');
const config = require('../config/config');

const client = createClient({ token: config.tokens.tenantA });
const ctx    = new TestContext();

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════

describe('Full Flow — Customer lifecycle', () => {
  let customerId;

  it('1. Create customer', async () => {
    const res  = await client.post('/customer', customerFactory());
    const data = expectSuccess(res);

    expectUuid(data.id);
    customerId = ctx.register('customers', data.id);
    ctx.set('customerId', customerId);
  });

  it('2. Read customer back — all expected fields present', async () => {
    const id   = ctx.get('customerId');
    const res  = await client.get(`/customer/${id}`);
    const data = expectSuccess(res);

    expect(data.id).toBe(id);
    expect(typeof data.name).toBe('string');
  });

  it('3. Update customer name', async () => {
    const id   = ctx.get('customerId');
    const res  = await client.put(`/customer/${id}`, { name: 'Full-Flow Updated Name' });
    expectSuccess(res);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Full Flow — Request lifecycle', () => {
  let requestId;

  it('4. Create request for the customer', async () => {
    const customerId = ctx.get('customerId');
    const res  = await client.post('/requests', requestFactory(customerId));
    const data = expectSuccess(res);

    expectUuid(data.id);
    requestId = ctx.register('requests', data.id);
    ctx.set('requestId', requestId);
  });

  it('5. Read request back', async () => {
    const id   = ctx.get('requestId');
    const res  = await client.get(`/requests/${id}`);
    const data = expectSuccess(res);

    expect(data.id).toBe(id);
    expect(data.status).toBe('pending');
  });

  it('6. Request appears in list', async () => {
    const id   = ctx.get('requestId');
    const res  = await client.get('/requests');
    const data = expectSuccess(res);

    expect(Array.isArray(data)).toBe(true);
    const found = data.find((r) => r.id === id);
    expect(found).toBeDefined();
  });

  it('7. Advance request status: pending → in_progress', async () => {
    const id = ctx.get('requestId');
    expectSuccess(await client.put(`/requests/${id}`, { status: 'in_progress' }));
  });

  it('8. Advance request status: in_progress → resolved', async () => {
    const id = ctx.get('requestId');
    expectSuccess(await client.put(`/requests/${id}`, { status: 'resolved' }));
  });

  it('9. Read request — status is resolved', async () => {
    const id   = ctx.get('requestId');
    const data = expectSuccess(await client.get(`/requests/${id}`));
    expect(data.status).toBe('resolved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Full Flow — Resource lifecycle', () => {
  let resourceId;

  it('10. Create resource', async () => {
    const res  = await client.post('/resources', resourceFactory());
    const data = expectSuccess(res);

    expectUuid(data.id);
    resourceId = ctx.register('resources', data.id);
    ctx.set('resourceId', resourceId);
  });

  it('11. Read resource back', async () => {
    const id   = ctx.get('resourceId');
    const data = expectSuccess(await client.get(`/resources/${id}`));
    expect(data.id).toBe(id);
  });

  it('12. Resource appears in list', async () => {
    const id   = ctx.get('resourceId');
    const res  = await client.get('/resources');
    const data = expectSuccess(res);

    expect(Array.isArray(data)).toBe(true);
    expect(data.find((r) => r.id === id)).toBeDefined();
  });

  it('13. Archive resource (status → archived)', async () => {
    const id = ctx.get('resourceId');
    expectSuccess(await client.put(`/resources/${id}`, { status: 'archived' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Full Flow — Cleanup', () => {
  it('14. Delete request', async () => {
    const id = ctx.get('requestId');
    if (!id) return;
    expectSuccess(await client.delete(`/requests/${id}`));
    ctx._resources.requests = ctx._resources.requests?.filter((x) => x !== id) ?? [];
  });

  it('15. Delete resource', async () => {
    const id = ctx.get('resourceId');
    if (!id) return;
    expectSuccess(await client.delete(`/resources/${id}`));
    ctx._resources.resources = ctx._resources.resources?.filter((x) => x !== id) ?? [];
  });

  it('16. Delete customer', async () => {
    const id = ctx.get('customerId');
    if (!id) return;
    expectSuccess(await client.delete(`/customer/${id}`));
    ctx._resources.customers = ctx._resources.customers?.filter((x) => x !== id) ?? [];
  });
});
