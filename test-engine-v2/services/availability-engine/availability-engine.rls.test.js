'use strict';

/**
 * availability-engine — RLS / Tenant Isolation tests  [SCAFFOLD]
 *
 * STATUS: pending — availability-engine n8n workflows must be deployed first.
 *
 * All describe blocks use describe.skip so Jest counts them as pending
 * rather than executing them against a non-existent endpoint.
 *
 * HOW TO ACTIVATE:
 *   1. Deploy all four availability-engine n8n workflows and activate them.
 *   2. Seed working hours for a Tenant A customer via POST /api/v1/availability.
 *   3. Replace every `describe.skip` with `describe`.
 *   4. Fill in a real Tenant A customer_id in beforeAll.
 *   5. Run: npm run test:availability-engine
 *
 * ISOLATION INVARIANTS VERIFIED:
 *   - Tenant B's slot queries scoped to a Tenant A customer_id return no data (RLS enforces isolation)
 *   - Tenant B's own queries (no cross-tenant customer_id) never expose Tenant A's appointment data
 *   - Tenant A's data remains intact after all cross-tenant attempts
 *
 * V1 NOTE: The engine is anchored on customer_id (not resource_id).
 *   Tenant B cannot guess a valid customer_id from Tenant A because RLS filters by tenant_id
 *   derived from the JWT. Passing a Tenant A customer_id with a Tenant B token returns 200 with
 *   empty data (no rows match the RLS policy), not a 403 — this is by design.
 */

const { createClient }       = require('../../core/apiClient');
const { TestContext }        = require('../../core/context');
const { cleanupContext }     = require('../../core/cleanup');
const config                 = require('../../config/config');
const {
  expectSuccess,
  expectNoDataLeak,
}                            = require('../../core/assertions');
const {
  slotQueryFactory,
  slotCheckFactory,
  nextFreeFactory,
  dayViewFactory,
}                            = require('../../core/factories');

const ENDPOINTS = {
  slots:    '/api/v1/availability-engine/slots',
  check:    '/api/v1/availability-engine/check',
  nextFree: '/api/v1/availability-engine/next-free',
  dayView:  '/api/v1/availability-engine/day-view',
};

const clientA = createClient({ token: config.tokens.tenantA });
const clientB = createClient({ token: config.tokens.tenantB });

const ctx = new TestContext();

// ── Tenant A setup and teardown ────────────────────────────────────────────────

describe.skip('availability-engine / rls / setup', () => {
  // beforeAll / afterAll are inside describe.skip so they never execute.
  // When activating: move these hooks outside the skip or into the active describe block.
  beforeAll(async () => {
    // TODO: create a Tenant A customer, add working hours via POST /api/v1/availability,
    //       create a sample appointment, and register the customer_id:
    // ctx.register('customers', tenantACustomerId);
  });

  afterAll(async () => {
    await cleanupContext(ctx, { client: clientA });
  });
});

// ── Cross-tenant slots isolation ───────────────────────────────────────────────

describe.skip('availability-engine / rls / slots cross-tenant', () => {
  it("Tenant B querying with a Tenant A customer_id gets empty slot data (RLS filters rows)", async () => {
    // RLS on all tables is anchored to the JWT tenant_id.
    // Tenant B's token scopes all DB reads to Tenant B's rows.
    // Even with a valid Tenant A customer_id, the engine will find zero rows → empty slots.
    const tenantACustomerId = ctx.get('tenantACustomerId') || '00000000-0000-0000-0000-000000000001';
    const body = slotQueryFactory({ customer_id: tenantACustomerId });
    const res  = await clientB.post(ENDPOINTS.slots, body);
    // Acceptable: 200 with empty data[] (RLS yields nothing), or 400 (gateway rejected)
    expect([200, 400]).toContain(res.status);
    if (res.status === 200 && res.data.success) {
      // If engine returned 200, slots array must be empty — no Tenant A data leaked
      expect(res.data.data).toEqual([]);
      expectNoDataLeak(res, tenantACustomerId);
    }
  });

  it("Tenant B's own slot query (own customer_id) returns only Tenant B data", async () => {
    // Tenant B queries its own customer — result must never include Tenant A slots.
    const tenantBCustomerId = ctx.get('tenantBCustomerId') || '00000000-0000-0000-0000-000000000002';
    const body = slotQueryFactory({ customer_id: tenantBCustomerId });
    const res  = await clientB.post(ENDPOINTS.slots, body);
    if (res.status === 200 && res.data.success) {
      const tenantACustomerId = ctx.get('tenantACustomerId');
      if (tenantACustomerId) {
        expectNoDataLeak(res, tenantACustomerId);
      }
    }
  });
});

// ── Cross-tenant check isolation ───────────────────────────────────────────────

describe.skip('availability-engine / rls / check cross-tenant', () => {
  it("Tenant B cannot check slot bookability for a Tenant A customer", async () => {
    const tenantACustomerId = ctx.get('tenantACustomerId') || '00000000-0000-0000-0000-000000000001';
    const body = slotCheckFactory({ customer_id: tenantACustomerId });
    const res  = await clientB.post(ENDPOINTS.check, body);
    // RLS returns no working hours → bookable: false (cannot book into non-existent schedule)
    expect([200, 400]).toContain(res.status);
    if (res.status === 200 && res.data.success) {
      // Must not report bookable:true based on Tenant A's schedule
      expect(res.data.data.bookable).toBe(false);
      expectNoDataLeak(res, tenantACustomerId);
    }
  });
});

// ── Cross-tenant next-free isolation ──────────────────────────────────────────

describe.skip('availability-engine / rls / next-free cross-tenant', () => {
  it("Tenant B's next-free query for Tenant A customer returns null (no schedule visible)", async () => {
    const tenantACustomerId = ctx.get('tenantACustomerId') || '00000000-0000-0000-0000-000000000001';
    const body = nextFreeFactory({ customer_id: tenantACustomerId });
    const res  = await clientB.post(ENDPOINTS.nextFree, body);
    expect([200, 400]).toContain(res.status);
    if (res.status === 200 && res.data.success) {
      // No schedule visible under Tenant B's RLS context → null result
      expect(res.data.data).toBeNull();
      expectNoDataLeak(res, tenantACustomerId);
    }
  });
});

// ── Cross-tenant day-view isolation ───────────────────────────────────────────

describe.skip('availability-engine / rls / day-view cross-tenant', () => {
  it("Tenant B gets empty day-view for Tenant A's customer", async () => {
    const tenantACustomerId = ctx.get('tenantACustomerId') || '00000000-0000-0000-0000-000000000001';
    const body = dayViewFactory({ customer_id: tenantACustomerId });
    const res  = await clientB.post(ENDPOINTS.dayView, body);
    expect([200, 400]).toContain(res.status);
    if (res.status === 200 && res.data.success) {
      // RLS hides all Tenant A rows — day-view returns empty working windows
      expect(res.data.data.working_windows).toEqual([]);
      expectNoDataLeak(res, tenantACustomerId);
    }
  });
});

// ── Tenant A integrity check ───────────────────────────────────────────────────

describe.skip('availability-engine / rls / tenant-a integrity', () => {
  it("Tenant A's own slot query still works after all cross-tenant attempts", async () => {
    const tenantACustomerId = ctx.get('tenantACustomerId');
    const body = slotQueryFactory({ customer_id: tenantACustomerId });
    const res  = await clientA.post(ENDPOINTS.slots, body);
    expectSuccess(res);
  });

  it("Tenant A's day-view still works after all cross-tenant attempts", async () => {
    const tenantACustomerId = ctx.get('tenantACustomerId');
    const body = dayViewFactory({ customer_id: tenantACustomerId });
    const res  = await clientA.post(ENDPOINTS.dayView, body);
    expectSuccess(res);
  });
});
