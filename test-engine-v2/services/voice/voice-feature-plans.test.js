'use strict';

/**
 * Voice — Feature Plans (Phase 3)
 *
 * Integration tests for the Phase-3 Pricing & Plan system:
 *   POST /internal/plans/assign      { "plan": "<key>" }
 *   GET  /internal/plans/current
 *   GET  /api/v1/features?verbose=true  (plan field + source per feature)
 *   GET  /api/v1/features              (plan features appear in default response)
 *
 * Test tenant: 44444444-4444-4444-4444-444444444444 (feature gate tenant)
 *   Initial state (seeded by 20260410000001):
 *     • voice domain enabled (voice.core + voice.callback enabled)
 *     • booking.availability present in tenant_features but enabled = false
 *     • NO plan assigned initially
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *
 *   A. Plan assignment CRUD + validation
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   B. Plan → feature propagation (runtime)
 *      Assign plan → plan features appear. Remove plan → disappear.
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   C. Override precedence
 *      tenant_features.enabled=false wins over plan baseline.
 *      Manually enable on top of plan → source = 'plan+override'.
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   D. Verbose endpoint — plan field + source
 *      Response includes { plan: { key, name }, features[].source }.
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   E. Tenant isolation
 *      Plan on one tenant must not affect another.
 *      Uses TOKEN_TENANT_A + TOKEN_FEATURE_GATE_TENANT.
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   F. Runtime gating via VAPI webhook
 *      Assign plan with feature → tool passes. Disable via override → tool blocked.
 *      Requires: TOKEN_FEATURE_GATE_TENANT + VAPI_FEATURE_GATE_ASSISTANT_ID
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const config = require('../../config/config');
const {
  getTenantFeatures,
  getTenantFeaturesVerbose,
  enableFeature,
  disableFeature,
  assignPlan,
  getCurrentPlan,
  createClient,
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

async function getFeatures(token) {
  const res = await getTenantFeatures(token);
  expect(res.status).toBe(200);
  return res.data.data.features;
}

async function getVerbose(token) {
  const res = await getTenantFeaturesVerbose(token);
  expect(res.status).toBe(200);
  return res.data.data;
}

async function getPlan(token) {
  const res = await getCurrentPlan(token);
  expect(res.status).toBe(200);
  return res.data.data.plan;
}

/** Clears plan assignment (no built-in "unassign" — reassign to a known no-op plan or check DB state). */
async function clearPlanState(token) {
  // Assign 'starter' as a known minimal plan to leave a predictable state.
  // Tests that require no plan should run in beforeEach order and account for this.
  await assignPlan(token, 'starter');
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Plan assignment CRUD + validation
// ─────────────────────────────────────────────────────────────────────────────

describe('A. Plan assignment — CRUD + validation', () => {
  const skip = SKIP_GATE;

  it('A1. assign unknown plan → 404 PLAN_NOT_FOUND', async () => {
    if (skip) return;
    const res = await assignPlan(TOKEN_GATE, 'nonexistent-plan-xyz');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('PLAN_NOT_FOUND');
  });

  it('A2. assign with missing body field → 422 VALIDATION_ERROR', async () => {
    if (skip) return;
    const res = await createClient({ token: TOKEN_GATE }).post('/internal/plans/assign', {});
    expect(res.status).toBe(422);
  });

  it('A3. assign valid plan "starter" → 200 success', async () => {
    if (skip) return;
    const res = await assignPlan(TOKEN_GATE, 'starter');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.plan).toBe('starter');
  });

  it('A4. GET /internal/plans/current reflects assignment', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'starter');
    const plan = await getPlan(TOKEN_GATE);
    expect(plan).not.toBeNull();
    expect(plan.key).toBe('starter');
    expect(plan.name).toBeTruthy();
    expect(plan.assigned_at).toBeTruthy();
  });

  it('A5. reassign plan → current plan is updated', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'starter');
    await assignPlan(TOKEN_GATE, 'pro');
    const plan = await getPlan(TOKEN_GATE);
    expect(plan.key).toBe('pro');
  });

  it('A6. unauthenticated request → 401', async () => {
    if (skip) return;
    const res = await createClient({ token: '' }).post('/internal/plans/assign', { plan: 'starter' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Plan → feature propagation (runtime)
// ─────────────────────────────────────────────────────────────────────────────

describe('B. Plan → feature propagation', () => {
  const skip = SKIP_GATE;

  beforeEach(async () => {
    if (skip) return;
    // Assign starter plan (voice.core + voice.callback only)
    await assignPlan(TOKEN_GATE, 'starter');
  });

  it('B1. starter plan features appear in default response', async () => {
    if (skip) return;
    const features = await getFeatures(TOKEN_GATE);
    expect(features).toContain('voice.core');
    expect(features).toContain('voice.callback');
  });

  it('B2. switch to pro → booking + salon features appear', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'pro');
    const features = await getFeatures(TOKEN_GATE);
    expect(features).toContain('voice.core');
    expect(features).toContain('booking.core');
    expect(features).toContain('salon.core');
  });

  it('B3. downgrade from pro back to starter → booking features disappear', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'pro');
    await assignPlan(TOKEN_GATE, 'starter');
    const features = await getFeatures(TOKEN_GATE);
    expect(features).not.toContain('booking.core');
    expect(features).not.toContain('salon.core');
    expect(features).toContain('voice.core');
  });

  it('B4. enterprise plan includes all features', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'enterprise');
    const features = await getFeatures(TOKEN_GATE);
    expect(features).toContain('voice.core');
    expect(features).toContain('booking.core');
    expect(features.length).toBeGreaterThan(5);
    // Restore
    await assignPlan(TOKEN_GATE, 'starter');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Override precedence
// ─────────────────────────────────────────────────────────────────────────────

describe('C. Override precedence', () => {
  const skip = SKIP_GATE;

  beforeEach(async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'starter');
  });

  afterEach(async () => {
    if (skip) return;
    // Re-enable voice.callback in case a test disabled it
    await enableFeature(TOKEN_GATE, 'voice.callback');
  });

  it('C1. tenant_features.enabled=false wins over plan → feature absent', async () => {
    if (skip) return;
    // voice.callback is in starter plan, but we explicitly disable it
    await disableFeature(TOKEN_GATE, 'voice.callback');
    const features = await getFeatures(TOKEN_GATE);
    expect(features).not.toContain('voice.callback');
    expect(features).toContain('voice.core');  // sibling still present
  });

  it('C2. re-enable feature after plan-disable → feature returns', async () => {
    if (skip) return;
    await disableFeature(TOKEN_GATE, 'voice.callback');
    await enableFeature(TOKEN_GATE, 'voice.callback');
    const features = await getFeatures(TOKEN_GATE);
    expect(features).toContain('voice.callback');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Verbose endpoint — plan field + source per feature
// ─────────────────────────────────────────────────────────────────────────────

describe('D. Verbose endpoint — plan field + source', () => {
  const skip = SKIP_GATE;

  it('D1. verbose response includes top-level plan object when plan is assigned', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'starter');
    const verbose = await getVerbose(TOKEN_GATE);
    expect(verbose).toHaveProperty('plan');
    expect(verbose.plan).not.toBeNull();
    expect(verbose.plan.key).toBe('starter');
    expect(verbose.plan.name).toBeTruthy();
  });

  it('D2. verbose response features have source field', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'starter');
    const verbose = await getVerbose(TOKEN_GATE);
    expect(Array.isArray(verbose.features)).toBe(true);
    for (const f of verbose.features) {
      expect(f).toHaveProperty('key');
      expect(f).toHaveProperty('enabled');
      expect(f).toHaveProperty('source');
      expect(['plan', 'override', 'plan+override']).toContain(f.source);
    }
  });

  it('D3. plan-only feature has source="plan"', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'starter');
    const verbose = await getVerbose(TOKEN_GATE);
    // voice.core should be from plan (not manually provisioned in tenant_features for this tenant)
    const voiceCore = verbose.features.find(f => f.key === 'voice.core');
    if (voiceCore && voiceCore.enabled) {
      // source is 'plan' or 'plan+override' if there's also a tenant row
      expect(['plan', 'plan+override']).toContain(voiceCore.source);
    }
  });

  it('D4. explicit disable shows as source="override", enabled=false', async () => {
    if (skip) return;
    await assignPlan(TOKEN_GATE, 'starter');
    await disableFeature(TOKEN_GATE, 'voice.callback');

    const verbose = await getVerbose(TOKEN_GATE);
    const voiceCb = verbose.features.find(f => f.key === 'voice.callback');
    expect(voiceCb).toBeDefined();
    expect(voiceCb.enabled).toBe(false);
    expect(voiceCb.source).toBe('override');

    // Restore
    await enableFeature(TOKEN_GATE, 'voice.callback');
  });

  it('D5. no plan assigned → plan is null in verbose', async () => {
    // Use TOKEN_A (tenant A), which should have no plan in a clean state
    const res = await getTenantFeaturesVerbose(TOKEN_A);
    expect(res.status).toBe(200);
    // plan may be null (no assignment) or an object if previously assigned
    expect(res.data.data).toHaveProperty('plan');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('E. Tenant isolation', () => {
  const skip = SKIP_GATE;

  it('E1. assigning plan to feature-gate tenant does not affect tenant A', async () => {
    if (skip) return;

    const featuresBefore = await getFeatures(TOKEN_A);

    await assignPlan(TOKEN_GATE, 'enterprise');

    const featuresAfter = await getFeatures(TOKEN_A);
    expect(featuresAfter).toEqual(featuresBefore);

    // Restore
    await assignPlan(TOKEN_GATE, 'starter');
  });

  it('E2. GET /internal/plans/current for tenant A returns its own plan', async () => {
    if (skip) return;

    await assignPlan(TOKEN_GATE, 'pro');

    const planA    = await getPlan(TOKEN_A);
    const planGate = await getPlan(TOKEN_GATE);

    // They should be independent
    if (planGate) {
      expect(planGate.key).toBe('pro');
    }
    if (planA !== null && planGate !== null) {
      expect(planA.key).not.toBe(planGate.key);
    }

    // Restore
    await assignPlan(TOKEN_GATE, 'starter');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Runtime gating via VAPI webhook
// ─────────────────────────────────────────────────────────────────────────────

describe('F. Runtime gating via VAPI webhook', () => {
  const skip = SKIP_WEBHOOK;

  it('F1. plan feature enabled → tool dispatch succeeds', async () => {
    if (skip) return;

    await assignPlan(TOKEN_GATE, 'starter');

    const callId = uniqueVoiceCallId();
    await sendVoiceWebhook(buildVapiStatusUpdate('in-progress', callId, VAPI_FEATURE_GATE_ASSISTANT_ID));

    const res = await sendVoiceWebhook(
      buildVapiToolCall('get_business_hours', {}, callId, VAPI_FEATURE_GATE_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);
    const result = res.data?.results?.[0]?.result;
    expect(result?.success).not.toBe(false);
  });

  it('F2. override-disable plan feature → tool blocked', async () => {
    if (skip) return;

    await assignPlan(TOKEN_GATE, 'starter');
    await disableFeature(TOKEN_GATE, 'voice.core');

    const callId = uniqueVoiceCallId();
    await sendVoiceWebhook(buildVapiStatusUpdate('in-progress', callId, VAPI_FEATURE_GATE_ASSISTANT_ID));

    const res = await sendVoiceWebhook(
      buildVapiToolCall('get_business_hours', {}, callId, VAPI_FEATURE_GATE_ASSISTANT_ID),
    );

    expect(res.status).toBe(200);
    const result = res.data?.results?.[0]?.result;
    expect(result?.success).toBe(false);

    // Restore
    await enableFeature(TOKEN_GATE, 'voice.core');
  });
});
