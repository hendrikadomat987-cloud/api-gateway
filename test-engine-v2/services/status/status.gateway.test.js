'use strict';

/**
 * Status — Gateway Security Test Suite
 *
 * Verifies that the API Gateway enforces:
 *  - JWT authentication (missing / invalid / expired tokens → 401)
 *  - UUID validation in URL path segments
 *  - Route misuse: PUT/DELETE without :id must fail (no route match)
 *  - Query-param id must not bypass path-param routing
 *  - tenant_id is NEVER trusted from the request body
 *  - Extra fields are stripped before reaching n8n
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 */

const { createClient } = require('../../core/apiClient');
const { TestContext }  = require('../../core/context');
const {
  expectSuccess,
  expectUnauthorized,
  expectInvalidId,
} = require('../../core/assertions');
const config = require('../../config/config');

// ── Clients ───────────────────────────────────────────────────────────────────
const client            = createClient({ token: config.tokens.tenantA });
const noAuthClient      = createClient({ token: '' });
const invalidAuthClient = createClient({ token: config.tokens.invalid });
const expiredAuthClient = createClient({ token: config.tokens.expired });

// ── Context & fixtures ────────────────────────────────────────────────────────
const ctx = new TestContext();

const VALID_STATUS = {
  name:  'Gateway Test Agent',
  type:  'agent',
  value: 'online',
};

let sharedId;

beforeAll(async () => {
  const res  = await client.post('/status', VALID_STATUS);
  const data = expectSuccess(res);
  sharedId   = data.id;
  ctx.register('status', sharedId);
});

afterAll(async () => {
  if (sharedId) {
    await client.delete(`/status/${sharedId}`);
  }
  for (const id of ctx.getIds('status').filter((id) => id !== sharedId)) {
    await client.delete(`/status/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — JWT enforcement', () => {
  it('no Authorization header on POST → 401', async () => {
    const res = await noAuthClient.post('/status', VALID_STATUS);
    expectUnauthorized(res);
  });

  it('invalid token on GET list → 401', async () => {
    const res = await invalidAuthClient.get('/status');
    expectUnauthorized(res);
  });

  it('invalid token on GET by ID → 401', async () => {
    const res = await invalidAuthClient.get(`/status/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on PUT → 401', async () => {
    const res = await expiredAuthClient.put(`/status/${sharedId}`, { value: 'offline' });
    expectUnauthorized(res);
  });

  it('no token on DELETE → 401', async () => {
    const res = await noAuthClient.delete(`/status/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on POST → 401', async () => {
    const res = await expiredAuthClient.post('/status', VALID_STATUS);
    expectUnauthorized(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID PATH VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/status/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/status/not-a-uuid', { value: 'offline' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/status/not-a-uuid'));
  });

  it('GET with totally invalid format → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/status/totally-invalid-format'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTING SECURITY
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — Routing security', () => {
  it('PUT /status without ID → must fail (400/404/405)', async () => {
    const res = await client.put('/status', { value: 'offline' });
    expect(res.status).not.toBe(200);
  });

  it('DELETE /status without ID → must fail (400/404/405)', async () => {
    const res = await client.delete('/status');
    expect(res.status).not.toBe(200);
  });

  it('query-param id must not bypass path-param routing', async () => {
    const VALID_UUID = '00000000-0000-0000-0000-000000000099';
    const res        = await client.get(`/status?id=${VALID_UUID}`);

    if (res.status === 200 && res.data?.success === true && res.data?.data?.id === VALID_UUID) {
      throw new Error(
        `Gateway allowed query-param id bypass — routing security violation (id=${VALID_UUID})`
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INPUT SANITISATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — Input sanitisation', () => {
  it('tenant_id injected in body is ignored', async () => {
    const payload = {
      ...VALID_STATUS,
      name:      'Inject Tenant Test',
      tenant_id: 'evil-tenant-00000000-0000-0000-0000-000000000000',
    };
    const res = await client.post('/status', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('status', data.id);

      const readRes  = await client.get(`/status/${data.id}`);
      const readData = expectSuccess(readRes);
      if (readData.tenant_id) {
        expect(readData.tenant_id).not.toBe('evil-tenant-00000000-0000-0000-0000-000000000000');
      }
    }
  });

  it('extra fields in body are not persisted', async () => {
    const payload = { ...VALID_STATUS, name: 'Extra Fields Test', role: 'admin', injectedField: 'INJECTED_VALUE' };
    const res     = await client.post('/status', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('status', data.id);

      const readRes  = await client.get(`/status/${data.id}`);
      const readData = expectSuccess(readRes);
      expect(readData).not.toHaveProperty('injectedField');
    }
  });
});
