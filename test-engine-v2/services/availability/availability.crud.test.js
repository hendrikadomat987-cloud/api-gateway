'use strict';

/**
 * Availability — CRUD Test Suite (v2)
 *
 * Tests the full create/list/read/update/delete lifecycle for /availability.
 * Uses the fixture customer 00000000-0000-0000-0000-000000000001.
 * All created records are cleaned up explicitly in afterAll.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 * FIXTURE:       Customer 00000000-0000-0000-0000-000000000001 must exist in DB.
 */

const { createClient }    = require('../../core/apiClient');
const { TestContext }     = require('../../core/context');
const {
  expectSuccess,
  expectValidationError,
  expectInvalidId,
  expectUuid,
} = require('../../core/assertions');
const config = require('../../config/config');

const client = createClient({ token: config.tokens.tenantA });
const ctx    = new TestContext();

const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

const VALID_PAYLOAD = {
  customer_id: VALID_CUSTOMER_ID,
  day_of_week: 1,
  start_time:  '09:00',
  end_time:    '17:00',
  status:      'active',
};

let availabilityId;

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  // Nothing to pre-create — VALID_CUSTOMER_ID fixture is expected to exist.
});

afterAll(async () => {
  for (const id of ctx.getIds('availability')) {
    await client.delete(`/availability/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Availability — Create', () => {
  it('creates an availability slot with all valid fields', async () => {
    const res  = await client.post('/availability', VALID_PAYLOAD);
    const data = expectSuccess(res);

    expectUuid(data.id);
    availabilityId = data.id;
    ctx.register('availability', availabilityId);
  });

  it('creates with status defaulting when omitted', async () => {
    const payload = { customer_id: VALID_CUSTOMER_ID, day_of_week: 3, start_time: '10:00', end_time: '18:00' };
    const res  = await client.post('/availability', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('availability', data.id);
  });

  it('rejects missing customer_id → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { day_of_week: 1, start_time: '09:00', end_time: '17:00' });
    expectValidationError(res);
  });

  it('rejects non-UUID customer_id → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { ...VALID_PAYLOAD, customer_id: 'not-a-uuid' });
    expectValidationError(res);
  });

  it('rejects missing day_of_week → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, start_time: '09:00', end_time: '17:00' });
    expectValidationError(res);
  });

  it('rejects day_of_week out of range (7) → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { ...VALID_PAYLOAD, day_of_week: 7 });
    expectValidationError(res);
  });

  it('rejects missing start_time → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, day_of_week: 1, end_time: '17:00' });
    expectValidationError(res);
  });

  it('rejects invalid start_time format → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { ...VALID_PAYLOAD, start_time: '9:00am' });
    expectValidationError(res);
  });

  it('rejects missing end_time → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { customer_id: VALID_CUSTOMER_ID, day_of_week: 1, start_time: '09:00' });
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.post('/availability', { ...VALID_PAYLOAD, status: 'unknown' });
    expectValidationError(res);
  });

  it('ignores injected tenant_id in body', async () => {
    const payload = { ...VALID_PAYLOAD, tenant_id: 'evil-tenant', day_of_week: 5 };
    const res  = await client.post('/availability', payload);
    const data = expectSuccess(res);

    ctx.register('availability', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('evil-tenant');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIST
// ═════════════════════════════════════════════════════════════════════════════

describe('Availability — List', () => {
  it('returns an array', async () => {
    const res  = await client.get('/availability');
    const data = expectSuccess(res);
    expect(Array.isArray(data)).toBe(true);
  });

  it('list contains the created record', async () => {
    const res  = await client.get('/availability');
    const data = expectSuccess(res);
    const found = data.find((r) => r.id === availabilityId);
    expect(found).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Availability — Read by ID', () => {
  it('retrieves the created record', async () => {
    const res  = await client.get(`/availability/${availabilityId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(availabilityId);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.get('/availability/not-a-uuid'));
  });

  it('returns 404 or empty for a non-existent UUID', async () => {
    const res = await client.get('/availability/00000000-0000-0000-0000-000000000000');
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

describe('Availability — Update', () => {
  it('updates status and day_of_week', async () => {
    const res = await client.put(`/availability/${availabilityId}`, { status: 'inactive', day_of_week: 2 });
    expectSuccess(res);
  });

  it('partial update — status only', async () => {
    const res = await client.put(`/availability/${availabilityId}`, { status: 'active' });
    expectSuccess(res);
  });

  it('partial update — start_time only', async () => {
    const res = await client.put(`/availability/${availabilityId}`, { start_time: '08:00' });
    expectSuccess(res);
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    const res = await client.put(`/availability/${availabilityId}`, {});
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.put(`/availability/${availabilityId}`, { status: 'bogus' });
    expectValidationError(res);
  });

  it('rejects invalid day_of_week → VALIDATION_ERROR', async () => {
    const res = await client.put(`/availability/${availabilityId}`, { day_of_week: 9 });
    expectValidationError(res);
  });

  it('rejects invalid start_time format → VALIDATION_ERROR', async () => {
    const res = await client.put(`/availability/${availabilityId}`, { start_time: '9am' });
    expectValidationError(res);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.put('/availability/not-a-uuid', { status: 'active' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Availability — Delete', () => {
  it('deletes an existing record', async () => {
    const createRes = await client.post('/availability', { ...VALID_PAYLOAD, day_of_week: 6 });
    const id        = expectSuccess(createRes).id;

    const delRes = await client.delete(`/availability/${id}`);
    expectSuccess(delRes);
  });

  it('is idempotent — second delete returns deleted:true', async () => {
    const createRes = await client.post('/availability', { ...VALID_PAYLOAD, day_of_week: 0 });
    const id        = expectSuccess(createRes).id;

    await client.delete(`/availability/${id}`);
    const second = await client.delete(`/availability/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.delete('/availability/not-a-uuid'));
  });
});
