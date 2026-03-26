'use strict';

/**
 * Customers — CRUD Test Suite
 *
 * Tests the full create/read/update/delete lifecycle for the /customer endpoint.
 * All resources created here are cleaned up in afterAll.
 */

const { createClient }    = require('../../core/apiClient');
const { TestContext }      = require('../../core/context');
const { cleanupContext }   = require('../../core/cleanup');
const { customerFactory }  = require('../../core/factories');
const {
  expectSuccess,
  expectValidationError,
  expectInvalidId,
  expectUuid,
} = require('../../core/assertions');
const config = require('../../config/config');

const client = createClient({ token: config.tokens.tenantA });
const ctx    = new TestContext();

// ─────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer — Create', () => {
  it('creates a customer with name + email', async () => {
    const payload = customerFactory();
    const res     = await client.post('/customer', payload);
    const data    = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('customers', data.id);
    ctx.set('primaryId', data.id);
  });

  it('creates a customer with name + phone only', async () => {
    const payload = customerFactory({ email: undefined });
    delete payload.email;
    payload.phone = '+49123456789';
    const res  = await client.post('/customer', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('customers', data.id);
  });

  it('rejects missing name → VALIDATION_ERROR', async () => {
    const res = await client.post('/customer', { email: 'test@example.com' });
    expectValidationError(res);
  });

  it('rejects missing phone and email → VALIDATION_ERROR', async () => {
    const res = await client.post('/customer', { name: 'No Contact' });
    expectValidationError(res);
  });

  it('rejects invalid email format → VALIDATION_ERROR', async () => {
    const res = await client.post('/customer', { name: 'Bad Email', email: 'not-an-email' });
    expectValidationError(res);
  });

  it('ignores injected tenant_id in body', async () => {
    const payload = { ...customerFactory(), tenant_id: 'evil-tenant-id-injected' };
    const res     = await client.post('/customer', payload);
    const data    = expectSuccess(res);

    // tenant_id must come from JWT, not body — if returned it must NOT equal the injected value
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('evil-tenant-id-injected');
    }
    ctx.register('customers', data.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer — Read', () => {
  it('retrieves an existing customer by ID', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.get(`/customer/${id}`);
    const data = expectSuccess(res);

    expect(data.id).toBe(id);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    const res = await client.get('/customer/not-a-valid-uuid');
    expectInvalidId(res);
  });

  it('returns 404 or empty data for a non-existent UUID', async () => {
    const NON_EXISTING = '00000000-0000-0000-0000-000000000000';
    const res  = await client.get(`/customer/${NON_EXISTING}`);

    if (res.status === 404) {
      expect(res.data.success).toBe(false);
    } else {
      expect(res.status).toBe(200);
      // If 200, data must be null/empty — not a real record
      const data = res.data?.data;
      expect(!data || !data.id).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer — Update', () => {
  it('updates name only', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.put(`/customer/${id}`, { name: 'Updated Name' });
    expectSuccess(res);
  });

  it('updates email only', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.put(`/customer/${id}`, { email: 'updated@example.com' });
    expectSuccess(res);
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.put(`/customer/${id}`, {});
    expectValidationError(res);
  });

  it('rejects invalid email in update → VALIDATION_ERROR', async () => {
    const id  = ctx.get('primaryId');
    const res = await client.put(`/customer/${id}`, { email: 'bad-email' });
    expectValidationError(res);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    const res = await client.put('/customer/not-a-uuid', { name: 'X' });
    expectInvalidId(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Customer — Delete', () => {
  it('deletes an existing customer', async () => {
    // Create a fresh customer specifically for this delete test
    const res  = await client.post('/customer', customerFactory());
    const data = expectSuccess(res);
    const id   = data.id;

    const delRes = await client.delete(`/customer/${id}`);
    expectSuccess(delRes);
    // Do NOT re-register — already deleted, no cleanup needed
  });

  it('is idempotent — deleting twice returns success with deleted:true', async () => {
    const res  = await client.post('/customer', customerFactory());
    const id   = expectSuccess(res).id;

    await client.delete(`/customer/${id}`);
    const second = await client.delete(`/customer/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    const res = await client.delete('/customer/not-a-uuid');
    expectInvalidId(res);
  });
});
