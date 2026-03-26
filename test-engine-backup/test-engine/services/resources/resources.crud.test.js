'use strict';

/**
 * Resources — CRUD Test Suite
 */

const { createClient }   = require('../../core/apiClient');
const { TestContext }     = require('../../core/context');
const { cleanupContext }  = require('../../core/cleanup');
const { resourceFactory } = require('../../core/factories');
const {
  expectSuccess,
  expectValidationError,
  expectInvalidId,
  expectUuid,
} = require('../../core/assertions');
const config = require('../../config/config');

const client = createClient({ token: config.tokens.tenantA });
const ctx    = new TestContext();
let resourceId;

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Resource — Create', () => {
  it('creates a resource with all fields', async () => {
    const payload = resourceFactory();
    const res     = await client.post('/resources', payload);
    const data    = expectSuccess(res);

    expectUuid(data.id);
    resourceId = data.id;
    ctx.register('resources', resourceId);
  });

  it('creates a resource without optional fields (content, status)', async () => {
    const res  = await client.post('/resources', { name: 'Minimal Resource', type: 'faq' });
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('resources', data.id);
  });

  it('rejects missing name → VALIDATION_ERROR', async () => {
    expectValidationError(await client.post('/resources', { type: 'document' }));
  });

  it('rejects missing type → VALIDATION_ERROR', async () => {
    expectValidationError(await client.post('/resources', { name: 'No Type' }));
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    expectValidationError(await client.post('/resources', { name: 'Bad Type', type: 'video' }));
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    expectValidationError(await client.post('/resources', {
      name: 'Bad Status', type: 'faq', status: 'flying',
    }));
  });

  it('ignores injected tenant_id in body', async () => {
    const payload = { ...resourceFactory(), tenant_id: 'evil-tenant' };
    const res  = await client.post('/resources', payload);
    const data = expectSuccess(res);

    ctx.register('resources', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('evil-tenant');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIST
// ═════════════════════════════════════════════════════════════════════════════

describe('Resource — List', () => {
  it('returns an array', async () => {
    const res  = await client.get('/resources');
    const data = expectSuccess(res);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Resource — Read by ID', () => {
  it('retrieves the created resource', async () => {
    const res  = await client.get(`/resources/${resourceId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(resourceId);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.get('/resources/not-a-uuid'));
  });

  it('returns 404 or empty for a non-existent UUID', async () => {
    const res = await client.get('/resources/00000000-0000-0000-0000-000000000000');
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

describe('Resource — Update', () => {
  it('updates name only', async () => {
    expectSuccess(await client.put(`/resources/${resourceId}`, { name: 'Updated Name' }));
  });

  it('updates status to draft', async () => {
    expectSuccess(await client.put(`/resources/${resourceId}`, { status: 'draft' }));
  });

  it('updates content', async () => {
    expectSuccess(await client.put(`/resources/${resourceId}`, { content: 'New content body' }));
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    expectValidationError(await client.put(`/resources/${resourceId}`, {}));
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    expectValidationError(await client.put(`/resources/${resourceId}`, { type: 'video' }));
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    expectValidationError(await client.put(`/resources/${resourceId}`, { status: 'gone' }));
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.put('/resources/not-a-uuid', { name: 'X' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Resource — Delete', () => {
  it('deletes an existing resource', async () => {
    const res  = await client.post('/resources', resourceFactory());
    const id   = expectSuccess(res).id;

    expectSuccess(await client.delete(`/resources/${id}`));
  });

  it('is idempotent — second delete returns deleted:true', async () => {
    const res = await client.post('/resources', resourceFactory());
    const id  = expectSuccess(res).id;

    await client.delete(`/resources/${id}`);
    const second = await client.delete(`/resources/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.delete('/resources/not-a-uuid'));
  });
});
