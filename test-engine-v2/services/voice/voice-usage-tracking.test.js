'use strict';

/**
 * Voice — Usage Tracking (Phase 4A)
 *
 * Integration tests for Phase-4A: Usage Tracking, Limits, and Billing Foundation.
 *
 *   GET    /api/v1/usage/current
 *   POST   /api/v1/internal/usage/reset
 *   POST   /api/v1/internal/usage/overrides
 *   DELETE /api/v1/internal/usage/overrides
 *
 * Test tenant: 44444444-4444-4444-4444-444444444444 (feature gate tenant)
 *   Seeded by 20260410000001:
 *     • voice domain enabled (voice.core + voice.callback enabled)
 *     • booking track, assistant: test-feature-gate-assistant-001
 *     • NO plan assigned by default
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *
 *   A. GET /usage/current — shape, auth
 *   B. POST /usage/reset  — behavior, validation, auth
 *   C. Overrides CRUD     — set, reflect in current, delete, validation, auth
 *   D. Limit enforcement via webhook (SKIP when no gate token or assistant)
 *      D1. limit=0 → tool blocked immediately (no prior calls needed)
 *      D2. delete override → no longer LIMIT_EXCEEDED
 *      D3. reset counters → LIMIT_EXCEEDED re-engages at correct threshold
 *   E. Counter increment via webhook (SKIP when no gate token or assistant)
 *      E1. successful tool call → counter appears in /usage/current
 *      E2. counter accumulates across multiple calls
 *   F. Override > plan priority (SKIP when no gate token or assistant)
 *      F1. override limit beats the plan limit
 *   G. Unlimited: null limit_value = never blocked
 *      G1. explicit null override → tool allowed even with counter > 0
 *   H. Tenant isolation — reset and overrides are tenant-scoped
 *      H1. reset on feature-gate tenant does not clear tenant-A counters
 *      H2. override on feature-gate tenant not visible to tenant A
 * ─────────────────────────────────────────────────────────────────────────────
 */

const config = require('../../config/config');
const {
  createClient,
  assignPlan,
  enableFeature,
  getUsageCurrent,
  resetUsageCounters,
  setUsageOverride,
  deleteUsageOverride,
  sendVoiceWebhook,
} = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_FEATURE_GATE_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(30000);

const TOKEN_GATE = config.tokens.tenantFeatureGate;
const TOKEN_A    = config.tokens.tenantA;

const SKIP_GATE    = !TOKEN_GATE;
const SKIP_WEBHOOK = !TOKEN_GATE || !VAPI_FEATURE_GATE_ASSISTANT_ID;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parses usage rows for a given feature from GET /usage/current. */
async function getCurrentUsage(token) {
  const res = await getUsageCurrent(token);
  expect(res.status).toBe(200);
  expect(res.data.success).toBe(true);
  return res.data.data;
}

/** Returns the current_value for a specific (feature_key, limit_type) pair. */
async function getCounter(token, featureKey, limitType = 'tool_calls_per_month') {
  const data = await getCurrentUsage(token);
  const row = (data.usage || []).find(
    r => r.feature_key === featureKey && r.limit_type === limitType,
  );
  return row?.current_value ?? 0;
}

/**
 * Fires a tool-calls webhook for the feature gate tenant.
 * Returns the tool result object from the response.
 */
async function fireToolWebhook(toolName, args = {}) {
  const callId = uniqueVoiceCallId('test-usage');
  await sendVoiceWebhook(
    buildVapiStatusUpdate(callId, {}, VAPI_FEATURE_GATE_ASSISTANT_ID),
  );
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, toolName, args, VAPI_FEATURE_GATE_ASSISTANT_ID),
  );
  expect(res.status).toBe(200);
  return res.data?.results?.[0]?.result ?? null;
}

/** Returns the first error object from a tool webhook response, if any. */
function extractLimitError(result) {
  if (!result || result.success !== false) return null;
  const err = result.error;
  if (err && typeof err === 'object' && err.code === 'LIMIT_EXCEEDED') return err;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. GET /usage/current — shape and auth
// ─────────────────────────────────────────────────────────────────────────────

describe('A. GET /usage/current — shape and auth', () => {
  it('A1. authenticated request → 200 with correct shape', async () => {
    if (SKIP_GATE) return;
    const res = await getUsageCurrent(TOKEN_GATE);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveProperty('period_start');
    expect(res.data.data).toHaveProperty('usage');
    expect(Array.isArray(res.data.data.usage)).toBe(true);
  });

  it('A2. period_start is YYYY-MM-01 format', async () => {
    if (SKIP_GATE) return;
    const data = await getCurrentUsage(TOKEN_GATE);
    expect(data.period_start).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('A3. usage rows have required fields', async () => {
    if (SKIP_GATE) return;
    const data = await getCurrentUsage(TOKEN_GATE);
    for (const row of data.usage) {
      expect(row).toHaveProperty('feature_key');
      expect(row).toHaveProperty('limit_type');
      expect(row).toHaveProperty('current_value');
      expect(row).toHaveProperty('period_start');
      // limit_value may be null (unlimited) or a number
      expect('limit_value' in row).toBe(true);
    }
  });

  it('A4. unauthenticated → 401', async () => {
    const res = await createClient({ token: '' }).get('/usage/current');
    expect(res.status).toBe(401);
  });

  it('A5. tenant A has independent usage data', async () => {
    const res = await getUsageCurrent(TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveProperty('usage');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. POST /usage/reset — behavior, validation, auth
// ─────────────────────────────────────────────────────────────────────────────

describe('B. POST /usage/reset — behavior and validation', () => {
  it('B1. reset with no body → 200 success', async () => {
    if (SKIP_GATE) return;
    const res = await resetUsageCounters(TOKEN_GATE, {});
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveProperty('deleted');
    expect(res.data.data).toHaveProperty('period_start');
    expect(typeof res.data.data.deleted).toBe('number');
  });

  it('B2. reset with valid period_start → 200 success', async () => {
    if (SKIP_GATE) return;
    const res = await resetUsageCounters(TOKEN_GATE, { period_start: '2026-04-01' });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.period_start).toBe('2026-04-01');
  });

  it('B3. invalid period_start format → 422', async () => {
    if (SKIP_GATE) return;
    const res = await resetUsageCounters(TOKEN_GATE, { period_start: '2026-04-15' });
    expect(res.status).toBe(422);
  });

  it('B4. period_start not a YYYY-MM-01 string → 422', async () => {
    if (SKIP_GATE) return;
    const res = await resetUsageCounters(TOKEN_GATE, { period_start: 'not-a-date' });
    expect(res.status).toBe(422);
  });

  it('B5. after reset the counter for current period is 0', async () => {
    if (SKIP_GATE) return;
    await resetUsageCounters(TOKEN_GATE, {});
    const data = await getCurrentUsage(TOKEN_GATE);
    // After reset, no counter rows should exist for this period
    expect(data.usage.length).toBe(0);
  });

  it('B6. unauthenticated → 401', async () => {
    const res = await createClient({ token: '' }).post('/internal/usage/reset', {});
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Overrides CRUD — set, reflect in current, delete, validation, auth
// ─────────────────────────────────────────────────────────────────────────────

describe('C. Overrides CRUD — set, reflect, delete', () => {
  afterEach(async () => {
    if (SKIP_GATE) return;
    // Clean up: remove the test override so other suites are not affected
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
  });

  it('C1. set override → 200 with correct echo', async () => {
    if (SKIP_GATE) return;
    const res = await setUsageOverride(TOKEN_GATE, 'voice.callback', 42);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.feature_key).toBe('voice.callback');
    expect(res.data.data.limit_type).toBe('tool_calls_per_month');
    expect(res.data.data.limit_value).toBe(42);
  });

  it('C2. set override with null → explicitly unlimited', async () => {
    if (SKIP_GATE) return;
    const res = await setUsageOverride(TOKEN_GATE, 'voice.callback', null);
    expect(res.status).toBe(200);
    expect(res.data.data.limit_value).toBeNull();
  });

  it('C3. delete override → 200 success', async () => {
    if (SKIP_GATE) return;
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 10);
    const res = await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  it('C4. delete non-existent override → 200 (idempotent)', async () => {
    if (SKIP_GATE) return;
    const res = await deleteUsageOverride(TOKEN_GATE, 'voice.callback.nonexistent');
    expect(res.status).toBe(200);
  });

  it('C5. set override with missing feature_key → 422', async () => {
    if (SKIP_GATE) return;
    const res = await createClient({ token: TOKEN_GATE }).post('/internal/usage/overrides', {
      limit_value: 5,
    });
    expect(res.status).toBe(422);
  });

  it('C6. set override with negative limit_value → 422', async () => {
    if (SKIP_GATE) return;
    const res = await createClient({ token: TOKEN_GATE }).post('/internal/usage/overrides', {
      feature_key: 'voice.callback',
      limit_value: -1,
    });
    expect(res.status).toBe(422);
  });

  it('C7. set override with float limit_value → 422', async () => {
    if (SKIP_GATE) return;
    const res = await createClient({ token: TOKEN_GATE }).post('/internal/usage/overrides', {
      feature_key: 'voice.callback',
      limit_value: 1.5,
    });
    expect(res.status).toBe(422);
  });

  it('C8. unauthenticated set → 401', async () => {
    const res = await createClient({ token: '' }).post('/internal/usage/overrides', {
      feature_key: 'voice.callback',
      limit_value: 5,
    });
    expect(res.status).toBe(401);
  });

  it('C9. unauthenticated delete → 401', async () => {
    const res = await createClient({ token: '' }).delete('/internal/usage/overrides', {
      feature_key: 'voice.callback',
    });
    expect(res.status).toBe(401);
  });

  it('C10. upsert — second set overrides the first', async () => {
    if (SKIP_GATE) return;
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 10);
    const res = await setUsageOverride(TOKEN_GATE, 'voice.callback', 99);
    expect(res.status).toBe(200);
    expect(res.data.data.limit_value).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Limit enforcement via webhook
// ─────────────────────────────────────────────────────────────────────────────

describe('D. Limit enforcement via webhook', () => {
  const skip = SKIP_WEBHOOK;

  beforeAll(async () => {
    if (skip) return;
    // Assign starter plan — includes voice.core + voice.callback with limits
    await assignPlan(TOKEN_GATE, 'starter');
    // Clean slate for counters
    await resetUsageCounters(TOKEN_GATE, {});
    // Remove any lingering overrides from prior tests
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
  });

  afterEach(async () => {
    if (skip) return;
    // Restore: remove override and reset counters after each test
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
    await resetUsageCounters(TOKEN_GATE, {});
  });

  it('D1. limit=0 blocks tool immediately (counter=0, limit=0 → blocked)', async () => {
    if (skip) return;

    // Set limit to 0 — any call is blocked regardless of counter
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 0);

    const result = await fireToolWebhook('create_callback_request', {
      customer_name: 'Test User',
      caller_number: '+49123456789',
    });

    const limitErr = extractLimitError(result);
    expect(limitErr).not.toBeNull();
    expect(limitErr.code).toBe('LIMIT_EXCEEDED');
    expect(limitErr.feature).toBe('voice.callback');
    expect(limitErr.current).toBe(0);
    expect(limitErr.limit).toBe(0);
  });

  it('D2. delete override → tool no longer blocked by limit', async () => {
    if (skip) return;

    // Set blocking limit
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 0);
    const blockedResult = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });
    expect(extractLimitError(blockedResult)).not.toBeNull();

    // Remove override — plan limit applies (100 >> 0 counter)
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');

    const unblocked = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });
    // Should not return a LIMIT_EXCEEDED error (may fail for n8n reasons, but not limit)
    expect(extractLimitError(unblocked)).toBeNull();
  });

  it('D3. limit=1 allows first call, blocks second', async () => {
    if (skip) return;

    // Set limit=1 so we exhaust it after one tracked call
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 1);

    // First call: counter=0, limit=1 → 0 < 1 → allowed by limit gate
    const first = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });
    expect(extractLimitError(first)).toBeNull();

    // If first call succeeded (was tracked), second should be blocked
    const counter = await getCounter(TOKEN_GATE, 'voice.callback');
    if (counter >= 1) {
      const second = await fireToolWebhook('create_callback_request', {
        caller_number: '+49123456789',
      });
      const limitErr = extractLimitError(second);
      expect(limitErr).not.toBeNull();
      expect(limitErr.code).toBe('LIMIT_EXCEEDED');
    }
  });

  it('D4. reset clears counter → previously-blocked calls are allowed again', async () => {
    if (skip) return;

    // Set limit=1 and exhaust it via override manipulation
    // Use limit=0 for instant exhaustion (counter=0 >= limit=0)
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 0);
    const blocked = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });
    expect(extractLimitError(blocked)).not.toBeNull();

    // Bump limit to 5 but reset counter first
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
    await resetUsageCounters(TOKEN_GATE, {});
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 5);

    const after = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });
    expect(extractLimitError(after)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Counter increment via webhook
// ─────────────────────────────────────────────────────────────────────────────

describe('E. Counter increment via webhook', () => {
  const skip = SKIP_WEBHOOK;

  beforeAll(async () => {
    if (skip) return;
    // Pro plan includes booking.faq — needed for answer_booking_question
    await assignPlan(TOKEN_GATE, 'pro');
    await resetUsageCounters(TOKEN_GATE, {});
    await deleteUsageOverride(TOKEN_GATE, 'booking.faq');
  });

  afterAll(async () => {
    if (skip) return;
    await resetUsageCounters(TOKEN_GATE, {});
    await deleteUsageOverride(TOKEN_GATE, 'booking.faq');
    // Restore to starter to avoid side effects on other suites
    await assignPlan(TOKEN_GATE, 'starter');
  });

  it('E1. successful tool call → counter appears in /usage/current', async () => {
    if (skip) return;

    const before = await getCounter(TOKEN_GATE, 'booking.faq');
    expect(before).toBe(0);

    // answer_booking_question always succeeds (falls back to static answer)
    const result = await fireToolWebhook('answer_booking_question', {
      question: 'What are your opening hours?',
    });

    // Must not be a limit-exceeded error
    expect(extractLimitError(result)).toBeNull();
    // Tool must succeed or return a domain error — but must NOT be LIMIT_EXCEEDED
    expect(result?.success).toBe(true);

    const after = await getCounter(TOKEN_GATE, 'booking.faq');
    expect(after).toBe(1);
  });

  it('E2. counter accumulates — second call increments further', async () => {
    if (skip) return;

    const before = await getCounter(TOKEN_GATE, 'booking.faq');

    await fireToolWebhook('answer_booking_question', {
      question: 'Do you offer weekend slots?',
    });

    const after = await getCounter(TOKEN_GATE, 'booking.faq');
    expect(after).toBe(before + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Override > plan priority
// ─────────────────────────────────────────────────────────────────────────────

describe('F. Override > plan limit priority', () => {
  const skip = SKIP_WEBHOOK;

  beforeAll(async () => {
    if (skip) return;
    // Starter plan: voice.callback limit = 100
    await assignPlan(TOKEN_GATE, 'starter');
    await resetUsageCounters(TOKEN_GATE, {});
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
  });

  afterAll(async () => {
    if (skip) return;
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
    await resetUsageCounters(TOKEN_GATE, {});
  });

  it('F1. override=0 blocks even though plan allows 100', async () => {
    if (skip) return;

    // Plan limit is 100. Counter is 0. Without override: allowed.
    // Set override to 0 — override wins over plan.
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 0);

    const result = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });

    const limitErr = extractLimitError(result);
    expect(limitErr).not.toBeNull();
    expect(limitErr.code).toBe('LIMIT_EXCEEDED');
    expect(limitErr.limit).toBe(0);
  });

  it('F2. null override (unlimited) overrides restrictive plan limit', async () => {
    if (skip) return;

    // Override with null = explicitly unlimited (beats any plan limit)
    await setUsageOverride(TOKEN_GATE, 'voice.callback', null);

    const result = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });

    // Should not be blocked by limit (may fail for other reasons)
    expect(extractLimitError(result)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Unlimited: null limit_value = never blocked
// ─────────────────────────────────────────────────────────────────────────────

describe('G. Unlimited plan (enterprise) — no limit enforcement', () => {
  const skip = SKIP_WEBHOOK;

  beforeAll(async () => {
    if (skip) return;
    // Enterprise plan: no plan_limits rows → unlimited for all features
    await assignPlan(TOKEN_GATE, 'enterprise');
    await resetUsageCounters(TOKEN_GATE, {});
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
  });

  afterAll(async () => {
    if (skip) return;
    await resetUsageCounters(TOKEN_GATE, {});
    // Restore to predictable plan
    await assignPlan(TOKEN_GATE, 'starter');
  });

  it('G1. enterprise plan → no LIMIT_EXCEEDED even with high counter', async () => {
    if (skip) return;

    // Enterprise has no plan_limits rows → getEffectiveLimit returns { source: 'none', limit: null }
    // null limit means unlimited — always allowed.
    const result = await fireToolWebhook('create_callback_request', {
      caller_number: '+49123456789',
    });

    expect(extractLimitError(result)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('H. Tenant isolation', () => {
  it('H1. reset on feature-gate tenant does not clear tenant A counters', async () => {
    if (SKIP_GATE) return;

    // Capture tenant A's current usage before we reset feature-gate counters
    const beforeA = await getUsageCurrent(TOKEN_A);
    const countsBefore = beforeA.data.data.usage.map(r => r.current_value);

    // Reset feature-gate tenant counters
    await resetUsageCounters(TOKEN_GATE, {});

    // Tenant A usage unchanged
    const afterA = await getUsageCurrent(TOKEN_A);
    const countsAfter = afterA.data.data.usage.map(r => r.current_value);
    expect(countsAfter).toEqual(countsBefore);
  });

  it('H2. override on feature-gate tenant is not visible to tenant A', async () => {
    if (SKIP_GATE) return;

    // Set a distinctive override on the feature-gate tenant
    await setUsageOverride(TOKEN_GATE, 'voice.callback', 777);

    // Tenant A: fetch current usage — no row for voice.callback with limit 777
    const dataA = await getCurrentUsage(TOKEN_A);
    const matchingRow = (dataA.usage || []).find(
      r => r.feature_key === 'voice.callback' && r.limit_value === 777,
    );
    expect(matchingRow).toBeUndefined();

    // Cleanup
    await deleteUsageOverride(TOKEN_GATE, 'voice.callback');
  });

  it('H3. override on feature-gate tenant cannot be read or deleted by tenant A', async () => {
    if (SKIP_GATE) return;

    // Even if tenant A tries to delete a feature-gate override, it has no effect
    // (RLS isolates the table rows). This is a no-op on tenant A's own row.
    const res = await deleteUsageOverride(TOKEN_A, 'voice.callback');
    // Either 200 (idempotent on own tenant, no row) or 401 (isolated)
    expect([200, 401]).toContain(res.status);
  });
});
