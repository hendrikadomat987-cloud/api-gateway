'use strict';

/**
 * Availability — Gateway Security Test Suite
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
 * FIXTURE:       Customer 00000000-0000-0000-0000-000000000001 must exist in DB.
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
const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

const VALID_AVAILABILITY = {
  customer_id: VALID_CUSTOMER_ID,
  day_of_week: 1,
  start_time:  '09:00',
  end_time:    '17:00',
  status:      'active',
};

let sharedId;

beforeAll(async () => {
  const res  = await client.post('/availability', VALID_AVAILABILITY);
  const data = expectSuccess(res);
  sharedId   = data.id;
  ctx.register('availability', sharedId);
});

afterAll(async () => {
  if (sharedId) {
    await client.delete(`/availability/${sharedId}`);
  }
  // Also clean up any extra records created by sanitisation tests
  for (const id of ctx.getIds('availability').filter((id) => id !== sharedId)) {
    await client.delete(`/availability/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Availability — JWT enforcement', () => {
  it('no Authorization header on POST → 401', async () => {
    const res = await noAuthClient.post('/availability', VALID_AVAILABILITY);
    expectUnauthorized(res);
  });

  it('invalid token on GET list → 401', async () => {
    const res = await invalidAuthClient.get('/availability');
    expectUnauthorized(res);
  });

  it('invalid token on GET by ID → 401', async () => {
    const res = await invalidAuthClient.get(`/availability/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on PUT → 401', async () => {
    const res = await expiredAuthClient.put(`/availability/${sharedId}`, { status: 'inactive' });
    expectUnauthorized(res);
  });

  it('no token on DELETE → 401', async () => {
    const res = await noAuthClient.delete(`/availability/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on POST → 401', async () => {
    const res = await expiredAuthClient.post('/availability', VALID_AVAILABILITY);
    expectUnauthorized(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID PATH VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Availability — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/availability/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/availability/not-a-uuid', { status: 'inactive' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/availability/not-a-uuid'));
  });

  it('GET with totally invalid format → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/availability/totally-invalid-format'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTING SECURITY
// ═════════════════════════════════════════════════════════════════════════════

describe('Availability — Routing security', () => {
  it('PUT /availability without ID → must fail (400/404/405)', async () => {
    const res = await client.put('/availability', { status: 'inactive' });
    expect(res.status).not.toBe(200);
  });

  it('DELETE /availability without ID → must fail (400/404/405)', async () => {
    const res = await client.delete('/availability');
    expect(res.status).not.toBe(200);
  });

  it('query-param id must not bypass path-param routing', async () => {
    const VALID_UUID = '00000000-0000-0000-0000-000000000099';
    const res        = await client.get(`/availability?id=${VALID_UUID}`);

    // A 200 that returns the specific record by query param is a routing violation
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

describe('Availability — Input sanitisation', () => {
  it('tenant_id injected in body is ignored', async () => {
    const payload = {
      ...VALID_AVAILABILITY,
      tenant_id: 'evil-tenant-00000000-0000-0000-0000-000000000000',
    };
    const res = await client.post('/availability', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('availability', data.id);

      const readRes  = await client.get(`/availability/${data.id}`);
      const readData = expectSuccess(readRes);
      if (readData.tenant_id) {
        expect(readData.tenant_id).not.toBe('evil-tenant-00000000-0000-0000-0000-000000000000');
      }
    }
  });

  it('extra fields in body are not persisted', async () => {
    const payload = { ...VALID_AVAILABILITY, role: 'admin', injectedField: 'INJECTED_VALUE' };
    const res     = await client.post('/availability', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('availability', data.id);

      const readRes  = await client.get(`/availability/${data.id}`);
      const readData = expectSuccess(readRes);
      expect(readData).not.toHaveProperty('injectedField');
    }
  });
});
