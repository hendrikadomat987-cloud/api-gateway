'use strict';

/**
 * Customers — Gateway Security Test Suite
 *
 * Verifies that the API Gateway enforces:
 *  - JWT authentication (missing / invalid / expired tokens → 401)
 *  - UUID validation in URL path segments
 *  - tenant_id is NEVER trusted from the request body
 *  - Extra fields are stripped before reaching n8n
 */

const { createClient }   = require('../../core/apiClient');
const { TestContext }     = require('../../core/context');
const { cleanupContext }  = require('../../core/cleanup');
const { customerFactory } = require('../../core/factories');
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

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// SETUP
// ═════════════════════════════════════════════════════════════════════════════

let sharedId;

beforeAll(async () => {
  const res  = await client.post('/customer', customerFactory());
  const data = expectSuccess(res);
  sharedId   = data.id;
  ctx.register('customers', sharedId);
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer — JWT enforcement', () => {
  it('no Authorization header → 401', async () => {
    const res = await noAuthClient.post('/customer', customerFactory());
    expectUnauthorized(res);
  });

  it('invalid token → 401', async () => {
    const res = await invalidAuthClient.get(`/customer/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token → 401', async () => {
    const res = await expiredAuthClient.get(`/customer/${sharedId}`);
    expectUnauthorized(res);
  });

  it('no token on PUT → 401', async () => {
    const res = await noAuthClient.put(`/customer/${sharedId}`, { name: 'X' });
    expectUnauthorized(res);
  });

  it('no token on DELETE → 401', async () => {
    const res = await noAuthClient.delete(`/customer/${sharedId}`);
    expectUnauthorized(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/customer/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/customer/abc', { name: 'X' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/customer/abc'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INPUT SANITISATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer — Input sanitisation', () => {
  it('tenant_id injected in body is ignored', async () => {
    const payload = { ...customerFactory(), tenant_id: 'EVIL-TENANT-ID' };
    const res  = await client.post('/customer', payload);
    const data = expectSuccess(res);

    ctx.register('customers', data.id);

    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('EVIL-TENANT-ID');
    }
  });

  it('extra fields in body are not persisted', async () => {
    const payload = { ...customerFactory(), role: 'admin', __proto__: 'hack' };
    const res  = await client.post('/customer', payload);
    const data = expectSuccess(res);

    ctx.register('customers', data.id);

    expect(data).not.toHaveProperty('role');
  });
});
