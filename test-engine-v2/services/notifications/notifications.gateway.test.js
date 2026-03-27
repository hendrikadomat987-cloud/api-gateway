'use strict';

/**
 * Notifications — Gateway Security Test Suite
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

const VALID_NOTIFICATION = {
  customer_id: VALID_CUSTOMER_ID,
  channel:     'email',
  type:        'reminder',
  message:     'Gateway security test notification',
  status:      'pending',
};

let sharedId;

beforeAll(async () => {
  const res  = await client.post('/notifications', VALID_NOTIFICATION);
  const data = expectSuccess(res);
  sharedId   = data.id;
  ctx.register('notifications', sharedId);
});

afterAll(async () => {
  if (sharedId) {
    await client.delete(`/notifications/${sharedId}`);
  }
  // Also clean up any extra records created by sanitisation tests
  for (const id of ctx.getIds('notifications').filter((id) => id !== sharedId)) {
    await client.delete(`/notifications/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification — JWT enforcement', () => {
  it('no Authorization header on POST → 401', async () => {
    const res = await noAuthClient.post('/notifications', VALID_NOTIFICATION);
    expectUnauthorized(res);
  });

  it('invalid token on GET list → 401', async () => {
    const res = await invalidAuthClient.get('/notifications');
    expectUnauthorized(res);
  });

  it('invalid token on GET by ID → 401', async () => {
    const res = await invalidAuthClient.get(`/notifications/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on PUT → 401', async () => {
    const res = await expiredAuthClient.put(`/notifications/${sharedId}`, { status: 'sent' });
    expectUnauthorized(res);
  });

  it('no token on DELETE → 401', async () => {
    const res = await noAuthClient.delete(`/notifications/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token on POST → 401', async () => {
    const res = await expiredAuthClient.post('/notifications', VALID_NOTIFICATION);
    expectUnauthorized(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID PATH VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/notifications/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/notifications/not-a-uuid', { status: 'sent' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/notifications/not-a-uuid'));
  });

  it('GET with totally invalid format → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/notifications/totally-invalid-format'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTING SECURITY
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification — Routing security', () => {
  it('PUT /notifications without ID → must fail (400/404/405)', async () => {
    const res = await client.put('/notifications', { status: 'sent' });
    expect(res.status).not.toBe(200);
  });

  it('DELETE /notifications without ID → must fail (400/404/405)', async () => {
    const res = await client.delete('/notifications');
    expect(res.status).not.toBe(200);
  });

  it('query-param id must not bypass path-param routing', async () => {
    const VALID_UUID = '00000000-0000-0000-0000-000000000099';
    const res        = await client.get(`/notifications?id=${VALID_UUID}`);

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

describe('Notification — Input sanitisation', () => {
  it('tenant_id injected in body is ignored', async () => {
    const payload = {
      ...VALID_NOTIFICATION,
      tenant_id: 'evil-tenant-00000000-0000-0000-0000-000000000000',
    };
    const res = await client.post('/notifications', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('notifications', data.id);

      const readRes  = await client.get(`/notifications/${data.id}`);
      const readData = expectSuccess(readRes);
      if (readData.tenant_id) {
        expect(readData.tenant_id).not.toBe('evil-tenant-00000000-0000-0000-0000-000000000000');
      }
    }
  });

  it('extra fields in body are not persisted', async () => {
    const payload = { ...VALID_NOTIFICATION, role: 'admin', injectedField: 'INJECTED_VALUE' };
    const res     = await client.post('/notifications', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('notifications', data.id);

      const readRes  = await client.get(`/notifications/${data.id}`);
      const readData = expectSuccess(readRes);
      expect(readData).not.toHaveProperty('injectedField');
    }
  });
});
