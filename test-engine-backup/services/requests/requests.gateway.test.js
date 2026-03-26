'use strict';

/**
 * Requests — Gateway Security Test Suite
 */

const { createClient }                   = require('../../core/apiClient');
const { TestContext }                     = require('../../core/context');
const { cleanupContext }                  = require('../../core/cleanup');
const { customerFactory, requestFactory } = require('../../core/factories');
const {
  expectSuccess,
  expectUnauthorized,
  expectInvalidId,
  expectValidationError,
} = require('../../core/assertions');
const config = require('../../config/config');

const client            = createClient({ token: config.tokens.tenantA });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });

const ctx = new TestContext();
let customerId;
let requestId;

beforeAll(async () => {
  const custRes  = await client.post('/customer', customerFactory());
  customerId     = expectSuccess(custRes).id;
  ctx.register('customers', customerId);

  const reqRes = await client.post('/requests', requestFactory(customerId));
  requestId    = expectSuccess(reqRes).id;
  ctx.register('requests', requestId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Requests — JWT enforcement', () => {
  it('POST without token → 401', async () => {
    expectUnauthorized(await noAuthClient.post('/requests', requestFactory(customerId)));
  });

  it('GET list without token → 401', async () => {
    expectUnauthorized(await noAuthClient.get('/requests'));
  });

  it('GET by ID with invalid token → 401', async () => {
    expectUnauthorized(await invalidAuthClient.get(`/requests/${requestId}`));
  });

  it('GET by ID with expired token → 401', async () => {
    expectUnauthorized(await expiredAuthClient.get(`/requests/${requestId}`));
  });

  it('PUT without token → 401', async () => {
    expectUnauthorized(await noAuthClient.put(`/requests/${requestId}`, { status: 'closed' }));
  });

  it('DELETE without token → 401', async () => {
    expectUnauthorized(await noAuthClient.delete(`/requests/${requestId}`));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Requests — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/requests/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/requests/not-a-uuid', { status: 'pending' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/requests/not-a-uuid'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INPUT SANITISATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Requests — Input sanitisation', () => {
  it('tenant_id in body is stripped — stored tenant_id comes from JWT', async () => {
    const payload = { ...requestFactory(customerId), tenant_id: 'EVIL' };
    const res  = await client.post('/requests', payload);
    const data = expectSuccess(res);

    ctx.register('requests', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('EVIL');
    }
  });

  it('extra body fields are not persisted', async () => {
    const payload = { ...requestFactory(customerId), role: 'superadmin', injected: true };
    const res  = await client.post('/requests', payload);
    const data = expectSuccess(res);

    ctx.register('requests', data.id);
    expect(data).not.toHaveProperty('role');
    expect(data).not.toHaveProperty('injected');
  });
});
