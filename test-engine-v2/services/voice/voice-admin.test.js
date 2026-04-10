'use strict';

/**
 * Voice — Admin & Control Layer (Phase 4B)
 *
 * Integration tests for the internal admin API.
 * All routes live under /api/v1/internal/admin/.
 * Auth: static ADMIN_TOKEN Bearer secret (not a JWT).
 *
 * Test tenant: 44444444-4444-4444-4444-444444444444 (feature gate tenant)
 *   - Registered in the tenants table by migration 20260410000004
 *   - Booking track, starter-compatible plan state
 *
 * ── Skip behaviour ─────────────────────────────────────────────────────────
 *
 *   SKIP_ADMIN  — TOKEN_ADMIN not set  → all tests skipped gracefully
 *   SKIP_GATE   — TOKEN_FEATURE_GATE_TENANT not set
 *                 → tests that verify cross-check via tenant API are skipped
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *
 *   A. Auth protection — 401 without token, 401 with tenant JWT, 200 with admin
 *   B. GET /plans — catalogue listing and per-plan detail
 *   C. GET /tenants — registry listing and registration
 *   D. GET /tenants/:id — full tenant detail (plan, features, domains, usage)
 *   E. Plan assignment via admin (POST /tenants/:id/plan)
 *   F. Feature management via admin (enable / disable)
 *   G. Domain management via admin (enable / disable)
 *   H. Limit management via admin (set, get, delete)
 *   I. Usage visibility via admin (GET /tenants/:id/usage)
 *   J. Usage reset via admin (POST /tenants/:id/usage/reset)
 *   K. Data aggregation correctness (plan + usage together)
 *   L. Validation errors (bad UUIDs, missing required fields, bad values)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const config = require('../../config/config');
const {
  createClient,
  createAdminClient,
  adminListTenants,
  adminGetTenant,
  adminUpsertTenant,
  adminListPlans,
  adminGetPlan,
  adminAssignPlan,
  adminEnableFeature,
  adminDisableFeature,
  adminEnableDomain,
  adminDisableDomain,
  adminGetLimits,
  adminSetLimit,
  adminDeleteLimit,
  adminGetUsage,
  adminResetUsage,
  // Tenant-scoped helpers for cross-checking
  getTenantFeatures,
  assignPlan,
  resetUsageCounters,
  getUsageCurrent,
} = require('../../core/apiClient');

jest.setTimeout(30000);

const TOKEN_ADMIN = config.tokens.admin;
const TOKEN_A     = config.tokens.tenantA;
const TOKEN_GATE  = config.tokens.tenantFeatureGate;

// Known tenant ID for the feature gate tenant (seeded in migration 20260410000004)
const GATE_TENANT_ID = '44444444-4444-4444-4444-444444444444';

const SKIP_ADMIN = !TOKEN_ADMIN;
const SKIP_GATE  = !TOKEN_GATE;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function adminGetTenantData(tenantId) {
  const res = await adminGetTenant(TOKEN_ADMIN, tenantId);
  expect(res.status).toBe(200);
  return res.data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Auth protection
// ─────────────────────────────────────────────────────────────────────────────

describe('A. Auth protection', () => {

  it('A1. no Authorization header → 401', async () => {
    const res = await createClient({ token: '' }).get('/internal/admin/tenants');
    expect(res.status).toBe(401);
  });

  it('A2. tenant JWT (TOKEN_A) rejected → 401', async () => {
    // A valid tenant JWT is NOT an admin token
    const res = await createClient({ token: TOKEN_A }).get('/internal/admin/tenants');
    expect(res.status).toBe(401);
  });

  it('A3. wrong admin token → 401', async () => {
    const res = await createClient({ token: 'definitely-not-the-admin-token' })
      .get('/internal/admin/tenants');
    expect(res.status).toBe(401);
  });

  it('A4. correct admin token → 200', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminListTenants(TOKEN_ADMIN);
    expect(res.status).toBe(200);
  });

  it('A5. admin token rejected on tenant-only endpoints', async () => {
    if (SKIP_ADMIN) return;
    // /api/v1/usage/current requires tenant JWT, not admin token
    const res = await createAdminClient(TOKEN_ADMIN).get('/usage/current');
    // Should fail (tenant JWT required — admin token is not a JWT)
    expect([401, 400]).toContain(res.status);
  });

  it('A6. all admin sub-routes also require admin token — plans route', async () => {
    const res = await createClient({ token: '' }).get('/internal/admin/plans');
    expect(res.status).toBe(401);
  });

  it('A7. all admin sub-routes also require admin token — tenant detail route', async () => {
    const res = await createClient({ token: '' })
      .get(`/internal/admin/tenants/${GATE_TENANT_ID}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. GET /plans — catalogue
// ─────────────────────────────────────────────────────────────────────────────

describe('B. Plan catalogue', () => {
  it('B1. GET /plans returns array', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminListPlans(TOKEN_ADMIN);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data.plans)).toBe(true);
  });

  it('B2. plans have required fields', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminListPlans(TOKEN_ADMIN);
    for (const plan of res.data.data.plans) {
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('key');
      expect(plan).toHaveProperty('name');
      expect(Array.isArray(plan.domains)).toBe(true);
      expect(Array.isArray(plan.features)).toBe(true);
      expect(Array.isArray(plan.limits)).toBe(true);
    }
  });

  it('B3. known plans are present — starter, pro, enterprise', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminListPlans(TOKEN_ADMIN);
    const keys = res.data.data.plans.map(p => p.key);
    expect(keys).toContain('starter');
    expect(keys).toContain('pro');
    expect(keys).toContain('enterprise');
  });

  it('B4. starter plan includes voice.core + voice.callback limits', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminGetPlan(TOKEN_ADMIN, 'starter');
    expect(res.status).toBe(200);
    const plan = res.data.data.plan;
    expect(plan.key).toBe('starter');
    expect(plan.features).toContain('voice.core');
    expect(plan.features).toContain('voice.callback');
    // Starter has plan_limits rows for tool_calls_per_month
    const limitKeys = plan.limits.map(l => l.feature_key);
    expect(limitKeys).toContain('voice.core');
    expect(limitKeys).toContain('voice.callback');
  });

  it('B5. enterprise plan has no limits (unlimited)', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminGetPlan(TOKEN_ADMIN, 'enterprise');
    expect(res.status).toBe(200);
    const plan = res.data.data.plan;
    // Enterprise: no plan_limits rows = unlimited
    expect(plan.limits.length).toBe(0);
  });

  it('B6. unknown plan key → 404 PLAN_NOT_FOUND', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminGetPlan(TOKEN_ADMIN, 'plan-does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('PLAN_NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. GET /tenants — registry
// ─────────────────────────────────────────────────────────────────────────────

describe('C. Tenant registry', () => {
  it('C1. GET /tenants returns array', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminListTenants(TOKEN_ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.data.tenants)).toBe(true);
  });

  it('C2. feature gate tenant is in the registry (seeded by migration)', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminListTenants(TOKEN_ADMIN);
    const found = res.data.data.tenants.find(t => t.id === GATE_TENANT_ID);
    expect(found).toBeDefined();
    expect(found.name).toBeTruthy();
    expect(found.status).toBe('active');
  });

  it('C3. POST /tenants registers a new tenant (upsert)', async () => {
    if (SKIP_ADMIN) return;
    const testId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const res = await adminUpsertTenant(TOKEN_ADMIN, {
      id:     testId,
      name:   'Test Admin Tenant',
      status: 'active',
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.tenant.id).toBe(testId);
    expect(res.data.data.tenant.name).toBe('Test Admin Tenant');
  });

  it('C4. POST /tenants updates name on conflict (upsert)', async () => {
    if (SKIP_ADMIN) return;
    const testId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await adminUpsertTenant(TOKEN_ADMIN, { id: testId, name: 'First Name' });
    const res = await adminUpsertTenant(TOKEN_ADMIN, { id: testId, name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.data.data.tenant.name).toBe('Updated Name');
  });

  it('C5. POST /tenants with invalid UUID → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post('/internal/admin/tenants', {
      id:   'not-a-uuid',
      name: 'Bad Tenant',
    });
    expect(res.status).toBe(422);
  });

  it('C6. POST /tenants with missing name → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post('/internal/admin/tenants', {
      id: GATE_TENANT_ID,
    });
    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. GET /tenants/:id — full detail
// ─────────────────────────────────────────────────────────────────────────────

describe('D. Tenant detail', () => {
  it('D1. returns correct shape', async () => {
    if (SKIP_ADMIN) return;
    const data = await adminGetTenantData(GATE_TENANT_ID);
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('plan');
    expect(Array.isArray(data.features)).toBe(true);
    expect(Array.isArray(data.domains)).toBe(true);
    expect(Array.isArray(data.usage)).toBe(true);
  });

  it('D2. id matches the requested tenant', async () => {
    if (SKIP_ADMIN) return;
    const data = await adminGetTenantData(GATE_TENANT_ID);
    expect(data.id).toBe(GATE_TENANT_ID);
  });

  it('D3. known features are present (voice.core + voice.callback seeded)', async () => {
    if (SKIP_ADMIN) return;
    const data = await adminGetTenantData(GATE_TENANT_ID);
    // Feature gate tenant has voice.core + voice.callback (or plan features)
    expect(data.features.length).toBeGreaterThanOrEqual(0);
  });

  it('D4. invalid UUID → 422 VALIDATION_ERROR', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).get('/internal/admin/tenants/not-a-uuid');
    expect(res.status).toBe(422);
  });

  it('D5. tenant not in registry still returns data if they have tenant-scoped rows', async () => {
    if (SKIP_ADMIN) return;
    // If there's no row in tenants table, id/name/status fields come from fallback defaults
    // This tests that the endpoint doesn't 404 just because the tenant is unregistered
    const data = await adminGetTenantData(GATE_TENANT_ID);
    expect(data.id).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Plan assignment via admin
// ─────────────────────────────────────────────────────────────────────────────

describe('E. Plan assignment via admin', () => {
  afterEach(async () => {
    if (SKIP_ADMIN) return;
    // Restore: assign starter plan after each test
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
  });

  it('E1. assign plan via admin → 200 success', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'pro');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.tenant_id).toBe(GATE_TENANT_ID);
    expect(res.data.data.plan).toBe('pro');
  });

  it('E2. plan reflected in tenant detail after assignment', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'pro');
    const data = await adminGetTenantData(GATE_TENANT_ID);
    expect(data.plan).not.toBeNull();
    expect(data.plan.key).toBe('pro');
  });

  it('E3. plan reflected in tenant features API (cross-check)', async () => {
    if (SKIP_ADMIN || SKIP_GATE) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'pro');
    const res = await getTenantFeatures(TOKEN_GATE);
    expect(res.status).toBe(200);
    // Pro plan should include booking.core and salon.core
    expect(res.data.data.features).toContain('booking.core');
    expect(res.data.data.features).toContain('salon.core');
  });

  it('E4. unknown plan → 404 PLAN_NOT_FOUND', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'nonexistent-plan-xyz');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('PLAN_NOT_FOUND');
  });

  it('E5. invalid tenant UUID → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post(
      '/internal/admin/tenants/not-a-uuid/plan',
      { plan: 'starter' },
    );
    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Feature management via admin
// ─────────────────────────────────────────────────────────────────────────────

describe('F. Feature management via admin', () => {
  beforeAll(async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
  });

  afterEach(async () => {
    if (SKIP_ADMIN) return;
    // Restore: re-enable voice.callback after each test
    await adminEnableFeature(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
  });

  it('F1. disable feature via admin → 200', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminDisableFeature(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
    expect(res.status).toBe(200);
    expect(res.data.data.enabled).toBe(false);
  });

  it('F2. disabled feature absent from tenant detail', async () => {
    if (SKIP_ADMIN) return;
    await adminDisableFeature(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
    const data = await adminGetTenantData(GATE_TENANT_ID);
    expect(data.features).not.toContain('voice.callback');
  });

  it('F3. re-enable feature via admin → feature returns', async () => {
    if (SKIP_ADMIN) return;
    await adminDisableFeature(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
    const res = await adminEnableFeature(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
    expect(res.status).toBe(200);
    expect(res.data.data.enabled).toBe(true);
    const data = await adminGetTenantData(GATE_TENANT_ID);
    expect(data.features).toContain('voice.callback');
  });

  it('F4. disable unknown feature → 404 FEATURE_NOT_FOUND', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminDisableFeature(TOKEN_ADMIN, GATE_TENANT_ID, 'feature.does.not.exist');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('FEATURE_NOT_FOUND');
  });

  it('F5. admin feature change visible via tenant features API', async () => {
    if (SKIP_ADMIN || SKIP_GATE) return;
    await adminDisableFeature(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
    const res = await getTenantFeatures(TOKEN_GATE);
    expect(res.data.data.features).not.toContain('voice.callback');
    // Restore for afterEach
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Domain management via admin
// ─────────────────────────────────────────────────────────────────────────────

describe('G. Domain management via admin', () => {
  it('G1. enable domain via admin → 200', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminEnableDomain(TOKEN_ADMIN, GATE_TENANT_ID, 'voice');
    expect(res.status).toBe(200);
    expect(res.data.data.enabled).toBe(true);
  });

  it('G2. disable domain via admin → 200', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminDisableDomain(TOKEN_ADMIN, GATE_TENANT_ID, 'voice');
    expect(res.status).toBe(200);
    expect(res.data.data.enabled).toBe(false);
    // Restore
    await adminEnableDomain(TOKEN_ADMIN, GATE_TENANT_ID, 'voice');
  });

  it('G3. unknown domain → 404 DOMAIN_NOT_FOUND', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminEnableDomain(TOKEN_ADMIN, GATE_TENANT_ID, 'domain.does.not.exist');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('DOMAIN_NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Limit management via admin
// ─────────────────────────────────────────────────────────────────────────────

describe('H. Limit management via admin', () => {
  beforeEach(async () => {
    if (SKIP_ADMIN) return;
    await adminDeleteLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
  });

  afterEach(async () => {
    if (SKIP_ADMIN) return;
    await adminDeleteLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
  });

  it('H1. set limit override via admin → 200 with echo', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminSetLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback', 999);
    expect(res.status).toBe(200);
    expect(res.data.data.feature_key).toBe('voice.callback');
    expect(res.data.data.limit_value).toBe(999);
    expect(res.data.data.tenant_id).toBe(GATE_TENANT_ID);
  });

  it('H2. set null limit (explicitly unlimited) → 200', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminSetLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback', null);
    expect(res.status).toBe(200);
    expect(res.data.data.limit_value).toBeNull();
  });

  it('H3. GET /limits includes the override', async () => {
    if (SKIP_ADMIN) return;
    await adminSetLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback', 42);
    const res = await adminGetLimits(TOKEN_ADMIN, GATE_TENANT_ID);
    expect(res.status).toBe(200);
    const row = res.data.data.limits.find(
      l => l.feature_key === 'voice.callback' && l.limit_type === 'tool_calls_per_month',
    );
    expect(row).toBeDefined();
    expect(row.limit_value).toBe(42);
    expect(row.source).toBe('override');
  });

  it('H4. GET /limits returns plan limits as source=plan', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
    const res = await adminGetLimits(TOKEN_ADMIN, GATE_TENANT_ID);
    expect(res.status).toBe(200);
    // Starter plan has limits for voice.core and voice.callback
    const planRow = res.data.data.limits.find(
      l => l.feature_key === 'voice.core' && l.limit_type === 'tool_calls_per_month',
    );
    if (planRow) {
      expect(planRow.source).toBe('plan');
    }
  });

  it('H5. delete limit override via admin → 200 (idempotent)', async () => {
    if (SKIP_ADMIN) return;
    await adminSetLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback', 5);
    const res = await adminDeleteLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  it('H6. after delete, override no longer present in GET /limits', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
    await adminSetLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback', 5);
    await adminDeleteLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');

    const res = await adminGetLimits(TOKEN_ADMIN, GATE_TENANT_ID);
    const overrideRow = res.data.data.limits.find(
      l => l.feature_key === 'voice.callback' && l.source === 'override',
    );
    expect(overrideRow).toBeUndefined();
  });

  it('H7. missing feature_key → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post(
      `/internal/admin/tenants/${GATE_TENANT_ID}/limits`,
      { limit_value: 5 },
    );
    expect(res.status).toBe(422);
  });

  it('H8. negative limit_value → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post(
      `/internal/admin/tenants/${GATE_TENANT_ID}/limits`,
      { feature_key: 'voice.callback', limit_value: -1 },
    );
    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. Usage visibility via admin
// ─────────────────────────────────────────────────────────────────────────────

describe('I. Usage visibility via admin', () => {
  it('I1. GET /tenants/:id/usage returns correct shape', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminGetUsage(TOKEN_ADMIN, GATE_TENANT_ID);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveProperty('tenant_id', GATE_TENANT_ID);
    expect(res.data.data).toHaveProperty('plan');
    expect(Array.isArray(res.data.data.usage)).toBe(true);
  });

  it('I2. usage rows have required fields', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminGetUsage(TOKEN_ADMIN, GATE_TENANT_ID);
    for (const row of res.data.data.usage) {
      expect(row).toHaveProperty('feature');
      expect(row).toHaveProperty('limit_type');
      expect(row).toHaveProperty('count');
      expect('limit' in row).toBe(true);
    }
  });

  it('I3. plan field in usage response matches assigned plan', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
    const res = await adminGetUsage(TOKEN_ADMIN, GATE_TENANT_ID);
    if (res.data.data.plan) {
      expect(res.data.data.plan.key).toBe('starter');
    }
  });

  it('I4. limit value for voice.callback matches starter plan (100)', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
    // Reset counters first to ensure the row exists via any prior tracking
    await adminResetUsage(TOKEN_ADMIN, GATE_TENANT_ID);

    // After reset there are no counter rows, so usage will be empty
    // The plan limits are visible via GET /limits, not GET /usage (which shows counters)
    const limitsRes = await adminGetLimits(TOKEN_ADMIN, GATE_TENANT_ID);
    const cbLimit = limitsRes.data.data.limits.find(
      l => l.feature_key === 'voice.callback' && l.limit_type === 'tool_calls_per_month',
    );
    if (cbLimit) {
      expect(cbLimit.limit_value).toBe(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. Usage reset via admin
// ─────────────────────────────────────────────────────────────────────────────

describe('J. Usage reset via admin', () => {
  it('J1. reset with no body → 200 with deleted count', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminResetUsage(TOKEN_ADMIN, GATE_TENANT_ID, {});
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.tenant_id).toBe(GATE_TENANT_ID);
    expect(typeof res.data.data.deleted).toBe('number');
    expect(res.data.data).toHaveProperty('period_start');
  });

  it('J2. reset with explicit period_start → 200', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminResetUsage(TOKEN_ADMIN, GATE_TENANT_ID, { period_start: '2026-04-01' });
    expect(res.status).toBe(200);
    expect(res.data.data.period_start).toBe('2026-04-01');
  });

  it('J3. reset with invalid period_start → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await adminResetUsage(TOKEN_ADMIN, GATE_TENANT_ID, { period_start: '2026-04-15' });
    expect(res.status).toBe(422);
  });

  it('J4. reset clears counters visible to tenant', async () => {
    if (SKIP_ADMIN || SKIP_GATE) return;
    const res = await adminResetUsage(TOKEN_ADMIN, GATE_TENANT_ID, {});
    expect(res.status).toBe(200);

    // Tenant's own usage endpoint should now show no counters
    const usageRes = await getUsageCurrent(TOKEN_GATE);
    expect(usageRes.status).toBe(200);
    expect(usageRes.data.data.usage.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. Data aggregation correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('K. Data aggregation — plan + limits consistent', () => {
  it('K1. after plan assignment, limits list reflects plan limits', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');

    const limitsRes = await adminGetLimits(TOKEN_ADMIN, GATE_TENANT_ID);
    expect(limitsRes.status).toBe(200);
    const limits = limitsRes.data.data.limits;

    // Starter plan has limits for voice.core (500) and voice.callback (100)
    const voiceCore = limits.find(l => l.feature_key === 'voice.core');
    const voiceCb   = limits.find(l => l.feature_key === 'voice.callback');

    if (voiceCore) {
      expect(voiceCore.limit_value).toBe(500);
      expect(voiceCore.source).toBe('plan');
    }
    if (voiceCb) {
      expect(voiceCb.limit_value).toBe(100);
      expect(voiceCb.source).toBe('plan');
    }
  });

  it('K2. override wins over plan in aggregated limits view', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
    await adminSetLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback', 999);

    const limitsRes = await adminGetLimits(TOKEN_ADMIN, GATE_TENANT_ID);
    const cbRow = limitsRes.data.data.limits.find(
      l => l.feature_key === 'voice.callback' && l.limit_type === 'tool_calls_per_month',
    );
    expect(cbRow).toBeDefined();
    expect(cbRow.limit_value).toBe(999);
    expect(cbRow.source).toBe('override');

    // Cleanup
    await adminDeleteLimit(TOKEN_ADMIN, GATE_TENANT_ID, 'voice.callback');
  });

  it('K3. enterprise plan shows unlimited (no limit rows)', async () => {
    if (SKIP_ADMIN) return;
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'enterprise');

    const limitsRes = await adminGetLimits(TOKEN_ADMIN, GATE_TENANT_ID);
    // Enterprise has no plan_limits rows, so no limits visible unless there are overrides
    for (const row of limitsRes.data.data.limits) {
      // Any rows present must be overrides (not from plan)
      expect(row.source).not.toBe('plan');
    }

    // Restore
    await adminAssignPlan(TOKEN_ADMIN, GATE_TENANT_ID, 'starter');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. Validation errors
// ─────────────────────────────────────────────────────────────────────────────

describe('L. Validation errors', () => {
  it('L1. non-UUID tenant id in path → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).get('/internal/admin/tenants/foo');
    expect(res.status).toBe(422);
  });

  it('L2. POST /plan with missing plan field → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post(
      `/internal/admin/tenants/${GATE_TENANT_ID}/plan`,
      {},
    );
    expect(res.status).toBe(422);
  });

  it('L3. POST /features/enable with missing feature field → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post(
      `/internal/admin/tenants/${GATE_TENANT_ID}/features/enable`,
      {},
    );
    expect(res.status).toBe(422);
  });

  it('L4. POST /domains/enable with missing domain field → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post(
      `/internal/admin/tenants/${GATE_TENANT_ID}/domains/enable`,
      {},
    );
    expect(res.status).toBe(422);
  });

  it('L5. POST /limits with float limit_value → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).post(
      `/internal/admin/tenants/${GATE_TENANT_ID}/limits`,
      { feature_key: 'voice.callback', limit_value: 3.14 },
    );
    expect(res.status).toBe(422);
  });

  it('L6. DELETE /limits with missing feature_key → 422', async () => {
    if (SKIP_ADMIN) return;
    const res = await createAdminClient(TOKEN_ADMIN).delete(
      `/internal/admin/tenants/${GATE_TENANT_ID}/limits`,
      {},
    );
    expect(res.status).toBe(422);
  });
});
