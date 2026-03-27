'use strict';

/**
 * Notifications — CRUD Test Suite (v2)
 *
 * Tests the full create/list/read/update/delete lifecycle for /notifications.
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
  channel:     'email',
  type:        'reminder',
  message:     'CRUD test notification message',
  status:      'pending',
};

let notificationId;

// ─────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  for (const id of ctx.getIds('notifications')) {
    await client.delete(`/notifications/${id}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CREATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification — Create', () => {
  it('creates a notification with all valid fields', async () => {
    const res  = await client.post('/notifications', VALID_PAYLOAD);
    const data = expectSuccess(res);

    expectUuid(data.id);
    notificationId = data.id;
    ctx.register('notifications', notificationId);
  });

  it('creates without optional message field', async () => {
    const payload = { customer_id: VALID_CUSTOMER_ID, channel: 'sms', type: 'confirmation' };
    const res  = await client.post('/notifications', payload);
    const data = expectSuccess(res);

    expectUuid(data.id);
    ctx.register('notifications', data.id);
  });

  it('rejects missing customer_id → VALIDATION_ERROR', async () => {
    const res = await client.post('/notifications', { channel: 'email', type: 'reminder' });
    expectValidationError(res);
  });

  it('rejects non-UUID customer_id → VALIDATION_ERROR', async () => {
    const res = await client.post('/notifications', { ...VALID_PAYLOAD, customer_id: 'not-a-uuid' });
    expectValidationError(res);
  });

  it('rejects missing channel → VALIDATION_ERROR', async () => {
    const res = await client.post('/notifications', { customer_id: VALID_CUSTOMER_ID, type: 'reminder' });
    expectValidationError(res);
  });

  it('rejects invalid channel → VALIDATION_ERROR', async () => {
    const res = await client.post('/notifications', { ...VALID_PAYLOAD, channel: 'telegram' });
    expectValidationError(res);
  });

  it('rejects missing type → VALIDATION_ERROR', async () => {
    const res = await client.post('/notifications', { customer_id: VALID_CUSTOMER_ID, channel: 'email' });
    expectValidationError(res);
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    const res = await client.post('/notifications', { ...VALID_PAYLOAD, type: 'promo' });
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.post('/notifications', { ...VALID_PAYLOAD, status: 'queued' });
    expectValidationError(res);
  });

  it('ignores injected tenant_id in body', async () => {
    const payload = { ...VALID_PAYLOAD, tenant_id: 'evil-tenant', type: 'cancellation' };
    const res  = await client.post('/notifications', payload);
    const data = expectSuccess(res);

    ctx.register('notifications', data.id);
    if (data.tenant_id) {
      expect(data.tenant_id).not.toBe('evil-tenant');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIST
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification — List', () => {
  it('returns an array', async () => {
    const res  = await client.get('/notifications');
    const data = expectSuccess(res);
    expect(Array.isArray(data)).toBe(true);
  });

  it('list contains the created record', async () => {
    const res  = await client.get('/notifications');
    const data = expectSuccess(res);
    const found = data.find((r) => r.id === notificationId);
    expect(found).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification — Read by ID', () => {
  it('retrieves the created notification', async () => {
    const res  = await client.get(`/notifications/${notificationId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(notificationId);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.get('/notifications/not-a-uuid'));
  });

  it('returns 404 or empty for a non-existent UUID', async () => {
    const res = await client.get('/notifications/00000000-0000-0000-0000-000000000000');
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

describe('Notification — Update', () => {
  it('updates status and channel', async () => {
    const res = await client.put(`/notifications/${notificationId}`, { status: 'sent', channel: 'sms' });
    expectSuccess(res);
  });

  it('partial update — status only', async () => {
    const res = await client.put(`/notifications/${notificationId}`, { status: 'pending' });
    expectSuccess(res);
  });

  it('partial update — message only', async () => {
    const res = await client.put(`/notifications/${notificationId}`, { message: 'Updated message text' });
    expectSuccess(res);
  });

  it('rejects empty body → VALIDATION_ERROR', async () => {
    const res = await client.put(`/notifications/${notificationId}`, {});
    expectValidationError(res);
  });

  it('rejects invalid channel → VALIDATION_ERROR', async () => {
    const res = await client.put(`/notifications/${notificationId}`, { channel: 'fax' });
    expectValidationError(res);
  });

  it('rejects invalid type → VALIDATION_ERROR', async () => {
    const res = await client.put(`/notifications/${notificationId}`, { type: 'promo' });
    expectValidationError(res);
  });

  it('rejects invalid status → VALIDATION_ERROR', async () => {
    const res = await client.put(`/notifications/${notificationId}`, { status: 'bogus' });
    expectValidationError(res);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.put('/notifications/not-a-uuid', { status: 'sent' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification — Delete', () => {
  it('deletes an existing notification', async () => {
    const createRes = await client.post('/notifications', { ...VALID_PAYLOAD, type: 'update' });
    const id        = expectSuccess(createRes).id;

    const delRes = await client.delete(`/notifications/${id}`);
    expectSuccess(delRes);
  });

  it('is idempotent — second delete returns deleted:true', async () => {
    const createRes = await client.post('/notifications', { ...VALID_PAYLOAD, channel: 'push' });
    const id        = expectSuccess(createRes).id;

    await client.delete(`/notifications/${id}`);
    const second = await client.delete(`/notifications/${id}`);
    expectSuccess(second);
    expect(second.data.data.deleted).toBe(true);
  });

  it('returns 400 INVALID_ID for a non-UUID path segment', async () => {
    expectInvalidId(await client.delete('/notifications/not-a-uuid'));
  });
});
