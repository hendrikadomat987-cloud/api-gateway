'use strict';

/**
 * Resources — Gateway Security Test Suite
 */

const { createClient }   = require('../../core/apiClient');
const { TestContext }     = require('../../core/context');
const { cleanupContext }  = require('../../core/cleanup');
const { resourceFactory } = require('../../core/factories');
const {
  expectSuccess,
  expectUnauthorized,
  expectInvalidId,
} = require('../../core/assertions');
const config = require('../../config/config');

const client            = createClient({ token: config.tokens.tenantA });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });

const ctx = new TestContext();
let resourceId;

beforeAll(async () => {
  const res  = await client.post('/resources', resourceFactory());
  resourceId = expectSuccess(res).id;
  ctx.register('resources', resourceId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Resources — JWT enforcement', () => {
  it('POST without token → 401', async () => {
    expectUnauthorized(await noAuthClient.post('/resources', resourceFactory()));
  });

  it('GET list without token → 401', async () => {
    expectUnauthorized(await noAuthClient.get('/resources'));
  });

  it('GET by ID with invalid token → 401', async () => {
    expectUnauthorized(await invalidAuthClient.get(`/resources/${resourceId}`));
  });

  it('GET by ID with expired token → 401', async () => {
    expectUnauthorized(await expiredAuthClient.get(`/resources/${resourceId}`));
  });

  it('PUT without token → 401', async () => {
    expectUnauthorized(await noAuthClient.put(`/resources/${resourceId}`, { name: 'X' }));
  });

  it('DELETE without token → 401', async () => {
    expectUnauthorized(await noAuthClient.delete(`/resources/${resourceId}`));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Resources — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/resources/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/resources/not-a-uuid', { name: 'X' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/resources/not-a-uuid'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INPUT SANITISATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Resources — Input sanitisation', () => {
  it('tenant_id in body is stripped', async () => {
    const payload = { ...resourceFactory(), tenant_id: 'EVIL' };
    const res  = await client.post('/resources', payload);
    const data = expectSuccess(res);

    ctx.register('resources', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('EVIL');
    }
  });

  it('extra body fields are not persisted', async () => {
    const payload = { ...resourceFactory(), role: 'root', __injected: true };
    const res  = await client.post('/resources', payload);
    const data = expectSuccess(res);

    ctx.register('resources', data.id);
    expect(data).not.toHaveProperty('role');
    expect(data).not.toHaveProperty('__injected');
  });
});
