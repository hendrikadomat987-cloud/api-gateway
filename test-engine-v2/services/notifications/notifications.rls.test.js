'use strict';

/**
 * Notifications — Row-Level Security (RLS) Test Suite
 *
 * Verifies tenant isolation end-to-end:
 *  - Tenant B cannot read, update, or delete records owned by Tenant A
 *  - A 200 response that leaks Tenant A's data is a hard failure
 *
 * IMPORTANT: These tests target the API (gateway + n8n + DB) to confirm
 * end-to-end RLS enforcement. They do NOT connect to PostgreSQL directly.
 *
 * PRE-REQUISITE: SQL applied, workflows active, gateway deployed.
 * FIXTURE:       Customer 00000000-0000-0000-0000-000000000001 must exist in DB.
 */

const { createClient }  = require('../../core/apiClient');
const { TestContext }   = require('../../core/context');
const {
  expectSuccess,
  expectNoDataLeak,
} = require('../../core/assertions');
const config = require('../../config/config');

// ── Clients ───────────────────────────────────────────────────────────────────
const tenantA = createClient({ token: config.tokens.tenantA });
const tenantB = createClient({ token: config.tokens.tenantB });

// ── Context & fixtures ────────────────────────────────────────────────────────
const ctx = new TestContext();
const VALID_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

const VALID_NOTIFICATION = {
  customer_id: VALID_CUSTOMER_ID,
  channel:     'sms',
  type:        'confirmation',
  message:     'RLS isolation test notification',
  status:      'pending',
};

let ownedId;

beforeAll(async () => {
  const res  = await tenantA.post('/notifications', VALID_NOTIFICATION);
  const data = expectSuccess(res);
  ownedId    = data.id;
  ctx.register('notifications', ownedId);
});

afterAll(async () => {
  if (ownedId) {
    await tenantA.delete(`/notifications/${ownedId}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification RLS — Cross-tenant GET', () => {
  it('Tenant B cannot read Tenant A notification by ID', async () => {
    const res = await tenantB.get(`/notifications/${ownedId}`);
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant B list does not include Tenant A records', async () => {
    const res = await tenantB.get('/notifications');

    if (res.status === 200 && res.data && Array.isArray(res.data.data)) {
      const leaked = res.data.data.find((n) => n.id === ownedId);
      if (leaked) {
        throw new Error(
          `RLS VIOLATION: Tenant B list contains Tenant A notification ${ownedId}`
        );
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification RLS — Cross-tenant PUT', () => {
  it('Tenant B cannot update Tenant A notification', async () => {
    const res = await tenantB.put(`/notifications/${ownedId}`, { status: 'sent' });
    expectNoDataLeak(res, ownedId);
  });

  it('Tenant A record is unmodified after cross-tenant update attempt', async () => {
    const res  = await tenantA.get(`/notifications/${ownedId}`);
    const data = expectSuccess(res);

    // If status was changed by Tenant B, this would catch it
    expect(data.status).not.toBe('sent');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification RLS — Cross-tenant DELETE', () => {
  it('Tenant B cannot delete Tenant A notification', async () => {
    const res = await tenantB.delete(`/notifications/${ownedId}`);

    // If the delete appeared to succeed, Tenant A must still own the record
    if (res.status === 200 && res.data?.success === true) {
      const verifyRes = await tenantA.get(`/notifications/${ownedId}`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data?.data?.id).toBe(ownedId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Notification RLS — Post-attack integrity', () => {
  it('Tenant A record is intact after all cross-tenant attempts', async () => {
    const res  = await tenantA.get(`/notifications/${ownedId}`);
    const data = expectSuccess(res);
    expect(data.id).toBe(ownedId);
  });
});
