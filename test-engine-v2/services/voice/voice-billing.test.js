'use strict';

/**
 * Voice — Billing API (Phase 5A)
 *
 * Integration tests for the tenant-facing billing endpoints and the admin
 * billing read endpoint.  These tests verify the API contract and auth
 * enforcement; they do NOT exercise Stripe directly (no live Stripe keys
 * in CI/CD).
 *
 * ── Skip behaviour ─────────────────────────────────────────────────────────
 *
 *   SKIP_ADMIN  — TOKEN_ADMIN not set  → admin billing tests skipped
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *
 *   A. Auth protection
 *      A1  GET  /billing/subscriptions/current — 401 without token
 *      A2  POST /billing/customers/create      — 401 without token
 *      A3  POST /billing/subscriptions/create  — 401 without token
 *      A4  POST /billing/subscriptions/cancel  — 401 without token
 *      A5  GET  /admin/tenants/:id/billing     — 401 without admin token
 *
 *   B. Billing disabled (no STRIPE_SECRET_KEY)
 *      B1  GET  /billing/subscriptions/current — 200 (returns null fields when no Stripe sub)
 *      B2  POST /billing/customers/create      — 503 BILLING_DISABLED when Stripe not configured
 *      B3  POST /billing/subscriptions/create  — 503 BILLING_DISABLED when Stripe not configured
 *      B4  POST /billing/subscriptions/cancel  — 503 BILLING_DISABLED when Stripe not configured
 *
 *   C. Validation
 *      C1  POST /billing/subscriptions/create — 400 VALIDATION_ERROR when plan is missing
 *      C2  POST /billing/subscriptions/create — 400 VALIDATION_ERROR when plan is empty string
 *
 *   D. Admin billing endpoint
 *      D1  GET  /admin/tenants/:id/billing — 200 with correct shape (no Stripe sub)
 *      D2  GET  /admin/tenants/bad-uuid/billing — 422 VALIDATION_ERROR
 * ─────────────────────────────────────────────────────────────────────────────
 */

const config = require('../../config/config');
const {
  createClient,
  createAdminClient,
  adminGetBilling,
  billingCreateCustomer,
  billingCreateSubscription,
  billingGetSubscription,
  billingCancelSubscription,
} = require('../../core/apiClient');

// ── Skip flags ─────────────────────────────────────────────────────────────────

const SKIP_ADMIN = !config.tokens.admin;

// Known seeded tenant for admin billing tests (Tenant A).
// This UUID must exist in the tenants table.
const TENANT_A_ID = process.env.TENANT_A_ID || '00000000-0000-0000-0000-000000000001';

// ── Section A — Auth protection ────────────────────────────────────────────────

describe('Billing — A. Auth protection', () => {
  test('A1: GET /billing/subscriptions/current — 401 without token', async () => {
    const res = await billingGetSubscription('');
    expect(res.status).toBe(401);
  });

  test('A2: POST /billing/customers/create — 401 without token', async () => {
    const res = await billingCreateCustomer('');
    expect(res.status).toBe(401);
  });

  test('A3: POST /billing/subscriptions/create — 401 without token', async () => {
    const res = await billingCreateSubscription('', 'starter');
    expect(res.status).toBe(401);
  });

  test('A4: POST /billing/subscriptions/cancel — 401 without token', async () => {
    const res = await billingCancelSubscription('');
    expect(res.status).toBe(401);
  });

  test('A5: GET /admin/tenants/:id/billing — 401 without admin token', async () => {
    // Use tenant JWT as auth — should be rejected
    const res = await createClient({ token: config.tokens.tenantA })
      .get(`/internal/admin/tenants/${TENANT_A_ID}/billing`);
    expect(res.status).toBe(401);
  });
});

// ── Section B — Billing disabled / current subscription ───────────────────────

describe('Billing — B. Subscription current + disabled', () => {
  test('B1: GET /billing/subscriptions/current — 200 with null fields when no subscription', async () => {
    const res = await billingGetSubscription(config.tokens.tenantA);
    // This endpoint never returns 503 — Stripe is not required for reads
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    const data = res.data.data;
    expect(data).toHaveProperty('stripe_customer_id');
    expect(data).toHaveProperty('stripe_subscription_id');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('current_period_start');
    expect(data).toHaveProperty('current_period_end');
    expect(data).toHaveProperty('cancel_at_period_end');
    // May be null if no Stripe subscription has been created
    // We just assert the shape is present
  });

  test('B2: POST /billing/customers/create — 503 when Stripe not configured', async () => {
    const res = await billingCreateCustomer(config.tokens.tenantA);
    // If STRIPE_SECRET_KEY is set, this may return 200 (idempotent customer create).
    // If not set, it must return 503 BILLING_DISABLED.
    if (res.status === 503) {
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('BILLING_DISABLED');
    } else {
      // Stripe IS configured — accept 200 as well
      expect([200, 503]).toContain(res.status);
    }
  });

  test('B3: POST /billing/subscriptions/create — 503 or plan error when Stripe not configured', async () => {
    const res = await billingCreateSubscription(config.tokens.tenantA, 'starter');
    // Without Stripe: 503 BILLING_DISABLED
    // With Stripe but no price configured: 404 PLAN_NOT_MAPPED
    // With Stripe and price configured: 200
    expect([200, 404, 503]).toContain(res.status);
    if (res.status === 503) {
      expect(res.data.error.code).toBe('BILLING_DISABLED');
    }
    if (res.status === 404) {
      expect(res.data.error.code).toBe('PLAN_NOT_MAPPED');
    }
  });

  test('B4: POST /billing/subscriptions/cancel — 503 or 404 when no subscription', async () => {
    const res = await billingCancelSubscription(config.tokens.tenantA);
    // Without Stripe: 503 BILLING_DISABLED
    // With Stripe but no active subscription: 404 NO_SUBSCRIPTION
    expect([404, 503]).toContain(res.status);
    if (res.status === 503) {
      expect(res.data.error.code).toBe('BILLING_DISABLED');
    }
    if (res.status === 404) {
      expect(res.data.error.code).toBe('NO_SUBSCRIPTION');
    }
  });
});

// ── Section C — Validation ─────────────────────────────────────────────────────

describe('Billing — C. Validation', () => {
  test('C1: POST /billing/subscriptions/create — 400 when plan is missing', async () => {
    const res = await createClient({ token: config.tokens.tenantA })
      .post('/internal/billing/subscriptions/create', {});
    expect(res.status).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  test('C2: POST /billing/subscriptions/create — 400 when plan is empty string', async () => {
    const res = await createClient({ token: config.tokens.tenantA })
      .post('/internal/billing/subscriptions/create', { plan: '   ' });
    expect(res.status).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── Section D — Admin billing endpoint ────────────────────────────────────────

describe('Billing — D. Admin billing endpoint', () => {
  test('D1: GET /admin/tenants/:id/billing — 200 with correct shape', async () => {
    if (SKIP_ADMIN) {
      console.log('  [SKIP] TOKEN_ADMIN not set');
      return;
    }
    const res = await adminGetBilling(config.tokens.admin, TENANT_A_ID);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    const data = res.data.data;
    expect(data.tenant_id).toBe(TENANT_A_ID);
    expect(data).toHaveProperty('stripe_customer_id');
    expect(data).toHaveProperty('stripe_subscription_id');
    expect(data).toHaveProperty('stripe_price_id');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('current_period_start');
    expect(data).toHaveProperty('current_period_end');
    expect(data).toHaveProperty('cancel_at_period_end');
  });

  test('D2: GET /admin/tenants/bad-uuid/billing — 422 VALIDATION_ERROR', async () => {
    if (SKIP_ADMIN) {
      console.log('  [SKIP] TOKEN_ADMIN not set');
      return;
    }
    const res = await adminGetBilling(config.tokens.admin, 'not-a-uuid');
    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
  });
});
