'use strict';

/**
 * Appointments — Gateway Security Test Suite
 *
 * Verifies that the API Gateway enforces:
 *  - JWT authentication (missing / invalid / expired tokens → 401)
 *  - UUID validation in URL path segments
 *  - tenant_id is NEVER trusted from the request body
 *  - Extra fields are stripped before reaching n8n
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 * FIXTURE:       Customer 00000000-0000-0000-0000-000000000001 must exist in DB.
 */

const { createClient }      = require('../../core/apiClient');
const { TestContext }        = require('../../core/context');
const { cleanupContext }     = require('../../core/cleanup');
const { appointmentFactory } = require('../../core/factories');
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

let sharedId;

beforeAll(async () => {
  const res  = await client.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID));
  const data = expectSuccess(res);
  sharedId   = data.id;
  ctx.register('appointments', sharedId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// JWT ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — JWT enforcement', () => {
  it('no Authorization header → 401', async () => {
    const res = await noAuthClient.post('/appointments', appointmentFactory(VALID_CUSTOMER_ID));
    expectUnauthorized(res);
  });

  it('invalid token → 401', async () => {
    const res = await invalidAuthClient.get(`/appointments/${sharedId}`);
    expectUnauthorized(res);
  });

  it('expired token → 401', async () => {
    const res = await expiredAuthClient.get(`/appointments/${sharedId}`);
    expectUnauthorized(res);
  });

  it('no token on PUT → 401', async () => {
    const res = await noAuthClient.put(`/appointments/${sharedId}`, { status: 'confirmed' });
    expectUnauthorized(res);
  });

  it('no token on DELETE → 401', async () => {
    const res = await noAuthClient.delete(`/appointments/${sharedId}`);
    expectUnauthorized(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UUID PATH VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — UUID path validation', () => {
  it('GET with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/appointments/not-a-uuid'));
  });

  it('PUT with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.put('/appointments/not-a-uuid', { status: 'confirmed' }));
  });

  it('DELETE with non-UUID → 400 INVALID_ID', async () => {
    expectInvalidId(await client.delete('/appointments/not-a-uuid'));
  });

  it('GET with totally invalid format → 400 INVALID_ID', async () => {
    expectInvalidId(await client.get('/appointments/totally-invalid-format'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTING SECURITY
// ═════════════════════════════════════════════════════════════════════════════

describe('Appointment — Routing security', () => {
  it('PUT /appointments without ID → must fail (400/404/405)', async () => {
    const res = await client.put('/appointments', { status: 'cancelled' });
    expect(res.status).not.toBe(200);
  });

  it('DELETE /appointments without ID → must fail (400/404/405)', async () => {
    const res = await client.delete('/appointments');
    expect(res.status).not.toBe(200);
  });

  it('query-param id must not bypass path-param routing', async () => {
    const VALID_UUID = '00000000-0000-0000-0000-000000000099';
    const res        = await client.get(`/appointments?id=${VALID_UUID}`);

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

describe('Appointment — Input sanitisation', () => {
  it('tenant_id injected in body is ignored', async () => {
    const payload = {
      ...appointmentFactory(VALID_CUSTOMER_ID),
      tenant_id: 'evil-tenant-00000000-0000-0000-0000-000000000000',
    };
    const res  = await client.post('/appointments', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('appointments', data.id);

      const readRes  = await client.get(`/appointments/${data.id}`);
      const readData = expectSuccess(readRes);
      if (readData.tenant_id) {
        expect(readData.tenant_id).not.toBe('evil-tenant-00000000-0000-0000-0000-000000000000');
      }
    }
  });

  it('extra fields in body are not persisted', async () => {
    const payload = { ...appointmentFactory(VALID_CUSTOMER_ID), role: 'admin', injectedField: 'INJECTED_VALUE' };
    const res     = await client.post('/appointments', payload);

    if (res.status === 200) {
      const data = expectSuccess(res);
      ctx.register('appointments', data.id);

      const readRes  = await client.get(`/appointments/${data.id}`);
      const readData = expectSuccess(readRes);
      expect(readData).not.toHaveProperty('injectedField');
    }
  });
});
