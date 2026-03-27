'use strict';

/**
 * Knowledge — CRUD Test Suite (v2)
 *
 * Tests the full create/list/read/update/delete lifecycle for /knowledge.
 * No FK dependencies — knowledge records are self-contained.
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
  title:    'Integration Test Article',
  content:  'This is the content of the integration test article.',
  category: 'general',
  status:   'draft',
};

let knowledgeId;

// ─────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  for (const id of ctx.getIds('knowledge')) {
    await client.delete(`/knowledge/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge — Create', () => {
  it('creates a knowledge record with all valid fields', async () => {
    const res  = await client.post('/knowledge', VALID_PAYLOAD);
    const data = expectSuccess(res);

    expectUuid(data.id);
    knowledgeId = data.id;
    ctx.register('knowledge', knowledgeId);
  });

  it('creates without category (optional)', async () => {
    const payload = { title: 'No Category Article', content: 'Some content here.' };
    const res  = await client.post('/knowledge', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('knowledge', data.id);
  });

  it('creates without status (defaults to draft)', async () => {
    const payload = { title: 'No Status Article', content: 'Content without explicit status.' };
    const res  = await client.post('/knowledge', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('knowledge', data.id);
  });

  it('creates with status published', async () => {
    const payload = { ...VALID_PAYLOAD, title: 'Published Article', status: 'published' };
    const res  = await client.post('/knowledge', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('knowledge', data.id);
  });

  it('rejects missing title → VALIDATION_ERROR', async () => {
    const res = await client.post('/knowledge', { content: 'Content without title.' });
    expectValidationError(res);
  });

  it('rejects empty title → VALIDATION_ERROR', async () => {
    const res = await client.post('/knowledge', { ...VALID_PAYLOAD, title: '' });
    expectValidationError(res);
  });

  it('rejects missing content → VALIDATION_ERROR', async () => {
    const res = await client.post('/knowledge', { title: 'Title without content' });
    expectValidationError(res);
  });

  it('rejects empty content → VALIDATION_ERROR', async () => {
    const res = await client.post('/knowledge', { ...VALID_PAYLOAD, content: '' });
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.post('/knowledge', { ...VALID_PAYLOAD, status: 'active' });
    expectValidationError(res);
  });

  it('ignores injected tenant_id in body', async () => {
    const payload = { ...VALID_PAYLOAD, tenant_id: 'evil-tenant', title: 'Inject Test' };
    const res  = await client.post('/knowledge', payload);
    const data = expectSuccess(res);

    ctx.register('knowledge', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('evil-tenant');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIST
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge — List', () => {
  it('returns an array', async () => {
    const res  = await client.get('/knowledge');
    const data = expectSuccess(res);
    expect(Array.isArray(data)).toBe(true);
  });

  it('list contains the created record', async () => {
    const res  = await client.get('/knowledge');
    const data = expectSuccess(res);
    const found = data.find((r) => r.id === knowledgeId);
    expect(found).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge — Read by ID', () => {
  it('retrieves the created record', async () => {
    const res  = await client.get(`/knowledge/${knowledgeId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(knowledgeId);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.get('/knowledge/not-a-uuid'));
  });

  it('returns 404 or empty for a non-existent UUID', async () => {
    const res = await client.get('/knowledge/00000000-0000-0000-0000-000000000000');
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

describe('Knowledge — Update', () => {
  it('updates title and status', async () => {
    const res = await client.put(`/knowledge/${knowledgeId}`, { title: 'Updated Title', status: 'published' });
    expectSuccess(res);
  });

  it('partial update — status only', async () => {
    const res = await client.put(`/knowledge/${knowledgeId}`, { status: 'archived' });
    expectSuccess(res);
  });

  it('partial update — content only', async () => {
    const res = await client.put(`/knowledge/${knowledgeId}`, { content: 'Updated content text.' });
    expectSuccess(res);
  });

  it('partial update — category only', async () => {
    const res = await client.put(`/knowledge/${knowledgeId}`, { category: 'faq' });
    expectSuccess(res);
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    const res = await client.put(`/knowledge/${knowledgeId}`, {});
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.put(`/knowledge/${knowledgeId}`, { status: 'active' });
    expectValidationError(res);
  });

  it('rejects empty title → VALIDATION_ERROR', async () => {
    const res = await client.put(`/knowledge/${knowledgeId}`, { title: '   ' });
    expectValidationError(res);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.put('/knowledge/not-a-uuid', { status: 'draft' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Knowledge — Delete', () => {
  it('deletes an existing record', async () => {
    const createRes = await client.post('/knowledge', { title: 'To Delete', content: 'Will be deleted.' });
    const id        = expectSuccess(createRes).id;

    const delRes = await client.delete(`/knowledge/${id}`);
    expectSuccess(delRes);
  });

  it('is idempotent — second delete returns deleted:true', async () => {
    const createRes = await client.post('/knowledge', { title: 'Delete Twice', content: 'Delete me twice.' });
    const id        = expectSuccess(createRes).id;

    await client.delete(`/knowledge/${id}`);
    const second = await client.delete(`/knowledge/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.delete('/knowledge/not-a-uuid'));
  });
});
