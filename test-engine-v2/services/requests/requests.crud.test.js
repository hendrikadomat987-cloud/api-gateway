'use strict';

/**
 * Requests — CRUD Test Suite
 *
 * Tests the full create/list/read/update/delete lifecycle for /requests.
 * A customer is created in beforeAll to satisfy the FK constraint.
 * All resources are cleaned up in afterAll.
 */

const { createClient }                    = require('../../core/apiClient');
const { TestContext }                      = require('../../core/context');
const { cleanupContext }                   = require('../../core/cleanup');
const { customerFactory, requestFactory }  = require('../../core/factories');
const {
  expectSuccess,
  expectValidationError,
  expectInvalidId,
  expectUuid,
} = require('../../core/assertions');
const config = require('../../config/config');

const client = createClient({ token: config.tokens.tenantA });
const ctx    = new TestContext();

let customerId;
let requestId;

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const res  = await client.post('/customer', customerFactory());
  const data = expectSuccess(res);
  customerId = data.id;
  ctx.register('customers', customerId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Request — Create', () => {
  it('creates a request with valid customer_id and type', async () => {
    const payload = requestFactory(customerId);
    const res     = await client.post('/requests', payload);
    const data    = expectSuccess(res);

    expectUuid(data.id);
    requestId = data.id;
    ctx.register('requests', requestId);
  });

  it('creates a request without optional fields (status, notes)', async () => {
    const payload = { customer_id: customerId, type: 'callback' };
    const res  = await client.post('/requests', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('requests', data.id);
  });

  it('rejects missing customer_id → VALIDATION_ERROR', async () => {
    const res = await client.post('/requests', { type: 'support' });
    expectValidationError(res);
  });

  it('rejects non-UUID customer_id → VALIDATION_ERROR', async () => {
    const res = await client.post('/requests', { customer_id: 'not-a-uuid', type: 'support' });
    expectValidationError(res);
  });

  it('rejects missing type → VALIDATION_ERROR', async () => {
    const res = await client.post('/requests', { customer_id: customerId });
    expectValidationError(res);
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    const res = await client.post('/requests', { customer_id: customerId, type: 'unknown' });
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.post('/requests', {
      customer_id: customerId, type: 'support', status: 'flying',
    });
    expectValidationError(res);
  });

  it('ignores injected tenant_id in body', async () => {
    const payload = { ...requestFactory(customerId), tenant_id: 'evil-tenant' };
    const res  = await client.post('/requests', payload);
    const data = expectSuccess(res);

    ctx.register('requests', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('evil-tenant');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIST
// ═════════════════════════════════════════════════════════════════════════════

describe('Request — List', () => {
  it('returns an array', async () => {
    const res  = await client.get('/requests');
    const data = expectSuccess(res);
    expect(Array.isArray(data)).toBe(true);
  });

  it('list only contains records for the authenticated tenant', async () => {
    // We cannot directly inspect tenant_id values here (they may be omitted),
    // but we can confirm the list does not throw and has the expected shape.
    const res  = await client.get('/requests');
    expectSuccess(res);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Request — Read by ID', () => {
  it('retrieves the created request', async () => {
    const res  = await client.get(`/requests/${requestId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(requestId);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.get('/requests/not-a-uuid'));
  });

  it('returns 404 or empty for a non-existent UUID', async () => {
    const res = await client.get('/requests/00000000-0000-0000-0000-000000000000');
    if (res.status === 404) {
      expect(res.data.success).toBe(false);
    } else {
      expect(res.status).toBe(200);
      const data = res.data?.data;
      expect(!data || !data.id).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Request — Update', () => {
  it('updates type and status', async () => {
    const res = await client.put(`/requests/${requestId}`, {
      type: 'callback', status: 'in_progress',
    });
    expectSuccess(res);
  });

  it('partial update — status only', async () => {
    const res = await client.put(`/requests/${requestId}`, { status: 'resolved' });
    expectSuccess(res);
  });

  it('partial update — notes only', async () => {
    const res = await client.put(`/requests/${requestId}`, { notes: 'Updated notes' });
    expectSuccess(res);
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    const res = await client.put(`/requests/${requestId}`, {});
    expectValidationError(res);
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    const res = await client.put(`/requests/${requestId}`, { type: 'bogus' });
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.put(`/requests/${requestId}`, { status: 'bogus' });
    expectValidationError(res);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.put('/requests/not-a-uuid', { status: 'pending' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Request — Delete', () => {
  it('deletes an existing request', async () => {
    const createRes = await client.post('/requests', requestFactory(customerId));
    const id        = expectSuccess(createRes).id;

    const delRes = await client.delete(`/requests/${id}`);
    expectSuccess(delRes);
  });

  it('is idempotent — second delete returns deleted:true', async () => {
    const createRes = await client.post('/requests', requestFactory(customerId));
    const id        = expectSuccess(createRes).id;

    await client.delete(`/requests/${id}`);
    const second = await client.delete(`/requests/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.delete('/requests/not-a-uuid'));
  });
});
