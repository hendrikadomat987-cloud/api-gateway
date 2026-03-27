'use strict';

/**
 * Status — CRUD Test Suite (v2)
 *
 * Tests the full create/list/read/update/delete lifecycle for /status.
 * No FK dependencies — status records are self-contained.
 * All created records are cleaned up explicitly in afterAll.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
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

const VALID_PAYLOAD = {
  name:        'Test Agent',
  type:        'agent',
  value:       'online',
  description: 'Integration test status record',
};

let statusId;

// ─────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  for (const id of ctx.getIds('status')) {
    await client.delete(`/status/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — Create', () => {
  it('creates a status record with all valid fields', async () => {
    const res  = await client.post('/status', VALID_PAYLOAD);
    const data = expectSuccess(res);

    expectUuid(data.id);
    statusId = data.id;
    ctx.register('status', statusId);
  });

  it('creates without value (defaults to unknown)', async () => {
    const payload = { name: 'Service Alpha', type: 'service' };
    const res  = await client.post('/status', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('status', data.id);
  });

  it('creates without description (optional)', async () => {
    const payload = { name: 'System Health', type: 'system', value: 'available' };
    const res  = await client.post('/status', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('status', data.id);
  });

  it('rejects missing name → VALIDATION_ERROR', async () => {
    const res = await client.post('/status', { type: 'agent', value: 'online' });
    expectValidationError(res);
  });

  it('rejects empty name → VALIDATION_ERROR', async () => {
    const res = await client.post('/status', { ...VALID_PAYLOAD, name: '' });
    expectValidationError(res);
  });

  it('rejects missing type → VALIDATION_ERROR', async () => {
    const res = await client.post('/status', { name: 'Test', value: 'online' });
    expectValidationError(res);
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    const res = await client.post('/status', { ...VALID_PAYLOAD, type: 'invalid-type' });
    expectValidationError(res);
  });

  it('rejects invalid value → VALIDATION_ERROR', async () => {
    const res = await client.post('/status', { ...VALID_PAYLOAD, value: 'active' });
    expectValidationError(res);
  });

  it('ignores injected tenant_id in body', async () => {
    const payload = { ...VALID_PAYLOAD, tenant_id: 'evil-tenant', name: 'Inject Test' };
    const res  = await client.post('/status', payload);
    const data = expectSuccess(res);

    ctx.register('status', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('evil-tenant');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIST
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — List', () => {
  it('returns an array', async () => {
    const res  = await client.get('/status');
    const data = expectSuccess(res);
    expect(Array.isArray(data)).toBe(true);
  });

  it('list contains the created record', async () => {
    const res  = await client.get('/status');
    const data = expectSuccess(res);
    const found = data.find((r) => r.id === statusId);
    expect(found).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — Read by ID', () => {
  it('retrieves the created record', async () => {
    const res  = await client.get(`/status/${statusId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(statusId);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.get('/status/not-a-uuid'));
  });

  it('returns 404 or empty for a non-existent UUID', async () => {
    const res = await client.get('/status/00000000-0000-0000-0000-000000000000');
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

describe('Status — Update', () => {
  it('updates value and description', async () => {
    const res = await client.put(`/status/${statusId}`, { value: 'offline', description: 'updated' });
    expectSuccess(res);
  });

  it('partial update — value only', async () => {
    const res = await client.put(`/status/${statusId}`, { value: 'busy' });
    expectSuccess(res);
  });

  it('partial update — name only', async () => {
    const res = await client.put(`/status/${statusId}`, { name: 'Renamed Agent' });
    expectSuccess(res);
  });

  it('partial update — type only', async () => {
    const res = await client.put(`/status/${statusId}`, { type: 'resource' });
    expectSuccess(res);
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    const res = await client.put(`/status/${statusId}`, {});
    expectValidationError(res);
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    const res = await client.put(`/status/${statusId}`, { type: 'bad-type' });
    expectValidationError(res);
  });

  it('rejects invalid value → VALIDATION_ERROR', async () => {
    const res = await client.put(`/status/${statusId}`, { value: 'running' });
    expectValidationError(res);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.put('/status/not-a-uuid', { value: 'online' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Status — Delete', () => {
  it('deletes an existing record', async () => {
    const createRes = await client.post('/status', { ...VALID_PAYLOAD, name: 'To Delete' });
    const id        = expectSuccess(createRes).id;

    const delRes = await client.delete(`/status/${id}`);
    expectSuccess(delRes);
  });

  it('is idempotent — second delete returns deleted:true', async () => {
    const createRes = await client.post('/status', { ...VALID_PAYLOAD, name: 'To Delete Twice' });
    const id        = expectSuccess(createRes).id;

    await client.delete(`/status/${id}`);
    const second = await client.delete(`/status/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.delete('/status/not-a-uuid'));
  });
});
