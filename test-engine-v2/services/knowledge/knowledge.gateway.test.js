'use strict';

/**
 * Knowledge — Gateway Security Test Suite
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

const VALID_KNOWLEDGE = {
  title:   'Gateway Test Article',
  content: 'This article is used to test gateway security.',
  status:  'draft',
};

let sharedId;

beforeAll(async () => {
  const res  = await client.post('/knowledge', VALID_KNOWLEDGE);
  const data = expectSuccess(res);
  sharedId   = data.id;
  ctx.register('knowledge', sharedId);
});

afterAll(async () => {
  if (sharedId) {
    await client.delete(`/knowledge/${sharedId}`);
  }
  for (const id of ctx.getIds('knowledge').filter((id) => id !== sharedId)) {
    await client.delete(`/knowledge/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge — JWT enforcement', () => {
  it('no Authorization header on POST → 401', async () => {
    const res = await noAuthClient.post('/knowledge', VALID_KNOWLEDGE);
    expectUnauthorized(res);
  });

  it('invalid token on GET list → 401', async () => {
    const res = await invalidAuthClient.get('/knowledge');
    expectUnauthorized(res);
  });

  it('invalid token on GET by ID → 401', async () => {
    const res = await invalidAuthClient.get(`/knowledge/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on PUT → 401', async () => {
    const res = await expiredAuthClient.put(`/knowledge/${sharedId}`, { status: 'published' });
    expectUnauthorized(res);
  });

  it('no token on DELETE → 401', async () => {
    const res = await noAuthClient.delete(`/knowledge/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on POST → 401', async () => {
    const res = await expiredAuthClient.post('/knowledge', VALID_KNOWLEDGE);
    expectUnauthorized(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID PATH VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/knowledge/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/knowledge/not-a-uuid', { status: 'draft' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/knowledge/not-a-uuid'));
  });

  it('GET with totally invalid format → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/knowledge/totally-invalid-format'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTING SECURITY
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge — Routing security', () => {
  it('PUT /knowledge without ID → must fail (400/404/405)', async () => {
    const res = await client.put('/knowledge', { status: 'published' });
    expect(res.status).not.toBe(200);
  });

  it('DELETE /knowledge without ID → must fail (400/404/405)', async () => {
    const res = await client.delete('/knowledge');
    expect(res.status).not.toBe(200);
  });

  it('query-param id must not bypass path-param routing', async () => {
    const VALID_UUID = '00000000-0000-0000-0000-000000000099';
    const res        = await client.get(`/knowledge?id=${VALID_UUID}`);

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

describe('Knowledge — Input sanitisation', () => {
  it('tenant_id injected in body is ignored', async () => {
    const payload = {
      ...VALID_KNOWLEDGE,
      title:     'Inject Tenant Test',
      tenant_id: 'evil-tenant-00000000-0000-0000-0000-000000000000',
    };
    const res = await client.post('/knowledge', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('knowledge', data.id);

      const readRes  = await client.get(`/knowledge/${data.id}`);
      const readData = expectSuccess(readRes);
      if (readData.tenant_id) {
        expect(readData.tenant_id).not.toBe('evil-tenant-00000000-0000-0000-0000-000000000000');
      }
    }
  });

  it('extra fields in body are not persisted', async () => {
    const payload = { ...VALID_KNOWLEDGE, title: 'Extra Fields Test', role: 'admin', injectedField: 'INJECTED_VALUE' };
    const res     = await client.post('/knowledge', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('knowledge', data.id);

      const readRes  = await client.get(`/knowledge/${data.id}`);
      const readData = expectSuccess(readRes);
      expect(readData).not.toHaveProperty('injectedField');
    }
  });
});
