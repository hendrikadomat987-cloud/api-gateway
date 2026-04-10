'use strict';

/**
 * Voice — Feature Management (Phase 2)
 *
 * Integration tests for the Phase-2 feature management layer:
 *   POST /internal/features/domains/enable
 *   POST /internal/features/domains/disable
 *   POST /internal/features/features/enable
 *   POST /internal/features/features/disable
 *   GET  /api/v1/features?verbose=true
 *
 * Test tenant: 44444444-4444-4444-4444-444444444444 (feature gate tenant)
 *   Initial state (seeded by 20260410000001):
 *     • voice domain enabled (voice.core + voice.callback enabled)
 *     • booking domain NOT in tenant_domains
 *     • booking.availability present in tenant_features but enabled = false
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *
 *   A. Management endpoint CRUD + validation
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   B. Domain → Feature consistency
 *      Enable booking domain → booking features appear in GET /api/v1/features.
 *      Disable booking domain → booking features disappear.
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   C. Cache invalidation — observable behavior only
 *      Mutate state → re-read immediately → confirm new state is visible.
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   D. /api/v1/features?verbose=true
 *      Response shape, non-breaking default, disabled entries visible.
 *      D1–D2: shape tests (TOKEN_TENANT_A — always available)
 *      D3–D4: disabled-entry tests (TOKEN_FEATURE_GATE_TENANT)
 *
 *   E. Tenant isolation
 *      Mutations on one tenant must not affect another.
 *      Uses TOKEN_TENANT_A + TOKEN_FEATURE_GATE_TENANT.
 *      Requires: TOKEN_FEATURE_GATE_TENANT
 *
 *   F. Runtime gating after toggle (webhook path)
 *      Disable feature → tool blocked. Enable → tool passes. Disable again → blocked.
 *      Requires: TOKEN_FEATURE_GATE_TENANT + VAPI_FEATURE_GATE_ASSISTANT_ID
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const config = require('../../config/config');
const {
  getTenantFeatures,
  getTenantFeaturesVerbose,
  enableDomain,
  disableDomain,
  enableFeature,
  disableFeature,
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
  return res.data.data; // { features: string[], domains: string[] }
}

async function getVerbose(token) {
  const res = await getTenantFeaturesVerbose(token);
  expect(res.status).toBe(200);
  return res.data.data; // { features: [{key,enabled}], domains: [{key,name,enabled}] }
}

async function startCall(assistantId) {
  const callId = uniqueVoiceCallId('feat-mgmt');
  const res = await sendVoiceWebhook(buildVapiStatusUpdate(callId, {}, assistantId));
  if (res.status >= 300) throw new Error(`Call setup failed: HTTP ${res.status}`);
  return callId;
}

async function dispatchTool(callId, toolName, args, assistantId) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, toolName, args, assistantId),
  );
  expect(res.status).toBe(200);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`No results for tool '${toolName}'`);
  }
  return results[0].result;
}

/**
 * Restores the feature gate tenant to baseline:
 *   booking domain: disabled (no-op if already disabled or not provisioned)
 *   booking.availability: disabled (original migration state)
 */
async function restoreGateTenantBaseline() {
  if (!TOKEN_GATE) return;
  await disableDomain(TOKEN_GATE, 'booking');
  await disableFeature(TOKEN_GATE, 'booking.availability');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / feature / management', () => {

  // ── A. Management endpoints ───────────────────────────────────────────────

  describe('A. Management endpoints — CRUD + validation', () => {
    if (SKIP_GATE) {
      it.skip('TOKEN_FEATURE_GATE_TENANT not set — all A tests skipped', () => {});
    }

    beforeAll(async () => {
      if (SKIP_GATE) return;
      // Ensure a known baseline: booking domain disabled, booking.availability disabled
      await restoreGateTenantBaseline();
    });

    afterAll(async () => {
      if (SKIP_GATE) return;
      await restoreGateTenantBaseline();
    });

    // ── Authentication ────────────────────────────────────────────────────────

    it('A.1 unauthenticated request returns 401', async () => {
      const res = await createClient({ token: '' }).post(
        '/internal/features/domains/enable',
        { domain: 'booking' },
      );
      expect(res.status).toBe(401);
      expect(res.data.success).toBe(false);
    });

    // ── Domain validation ─────────────────────────────────────────────────────

    it('A.2 enableDomain — missing domain field returns 400', async () => {
      if (SKIP_GATE) return;
      const res = await createClient({ token: TOKEN_GATE }).post(
        '/internal/features/domains/enable',
        {},
      );
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('VALIDATION_ERROR');
    });

    it('A.3 disableDomain — missing domain field returns 400', async () => {
      if (SKIP_GATE) return;
      const res = await createClient({ token: TOKEN_GATE }).post(
        '/internal/features/domains/disable',
        {},
      );
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
    });

    it('A.4 enableDomain — unknown domain returns 404', async () => {
      if (SKIP_GATE) return;
      const res = await enableDomain(TOKEN_GATE, 'does-not-exist');
      expect(res.status).toBe(404);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('DOMAIN_NOT_FOUND');
    });

    it('A.5 disableDomain — unknown domain returns 404', async () => {
      if (SKIP_GATE) return;
      const res = await disableDomain(TOKEN_GATE, 'does-not-exist');
      expect(res.status).toBe(404);
      expect(res.data.success).toBe(false);
    });

    // ── Feature validation ────────────────────────────────────────────────────

    it('A.6 enableFeature — missing feature field returns 400', async () => {
      if (SKIP_GATE) return;
      const res = await createClient({ token: TOKEN_GATE }).post(
        '/internal/features/features/enable',
        {},
      );
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
    });

    it('A.7 disableFeature — missing feature field returns 400', async () => {
      if (SKIP_GATE) return;
      const res = await createClient({ token: TOKEN_GATE }).post(
        '/internal/features/features/disable',
        {},
      );
      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
    });

    it('A.8 enableFeature — unknown feature returns 404', async () => {
      if (SKIP_GATE) return;
      const res = await enableFeature(TOKEN_GATE, 'does.not.exist');
      expect(res.status).toBe(404);
      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe('FEATURE_NOT_FOUND');
    });

    it('A.9 disableFeature — unknown feature returns 404', async () => {
      if (SKIP_GATE) return;
      const res = await disableFeature(TOKEN_GATE, 'does.not.exist');
      expect(res.status).toBe(404);
      expect(res.data.success).toBe(false);
    });

    // ── Successful operations ─────────────────────────────────────────────────

    it('A.10 enableDomain — returns success + echo', async () => {
      if (SKIP_GATE) return;
      const res = await enableDomain(TOKEN_GATE, 'booking');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.domain).toBe('booking');
      expect(res.data.data.enabled).toBe(true);
    });

    it('A.11 enableDomain — idempotent (second call also succeeds)', async () => {
      if (SKIP_GATE) return;
      const res = await enableDomain(TOKEN_GATE, 'booking');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });

    it('A.12 disableDomain — returns success + echo', async () => {
      if (SKIP_GATE) return;
      const res = await disableDomain(TOKEN_GATE, 'booking');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.domain).toBe('booking');
      expect(res.data.data.enabled).toBe(false);
    });

    it('A.13 disableDomain — idempotent (second call also succeeds)', async () => {
      if (SKIP_GATE) return;
      const res = await disableDomain(TOKEN_GATE, 'booking');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });

    it('A.14 enableFeature — returns success + echo', async () => {
      if (SKIP_GATE) return;
      const res = await enableFeature(TOKEN_GATE, 'booking.availability');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.feature).toBe('booking.availability');
      expect(res.data.data.enabled).toBe(true);
    });

    it('A.15 enableFeature — idempotent (second call also succeeds)', async () => {
      if (SKIP_GATE) return;
      const res = await enableFeature(TOKEN_GATE, 'booking.availability');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });

    it('A.16 disableFeature — returns success + echo', async () => {
      if (SKIP_GATE) return;
      const res = await disableFeature(TOKEN_GATE, 'booking.availability');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data.feature).toBe('booking.availability');
      expect(res.data.data.enabled).toBe(false);
    });

    it('A.17 disableFeature — idempotent (second call also succeeds)', async () => {
      if (SKIP_GATE) return;
      const res = await disableFeature(TOKEN_GATE, 'booking.availability');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });
  });

  // ── B. Domain → Feature consistency ──────────────────────────────────────

  describe('B. Domain → Feature consistency', () => {
    if (SKIP_GATE) {
      it.skip('TOKEN_FEATURE_GATE_TENANT not set — section B skipped', () => {});
    }

    beforeAll(async () => {
      if (SKIP_GATE) return;
      await restoreGateTenantBaseline();
    });

    afterAll(async () => {
      if (SKIP_GATE) return;
      await restoreGateTenantBaseline();
    });

    it('B.1 booking.availability absent from GET /api/v1/features when domain disabled', async () => {
      if (SKIP_GATE) return;
      const data = await getFeatures(TOKEN_GATE);
      expect(data.features).not.toContain('booking.availability');
      expect(data.domains).not.toContain('booking');
    });

    it('B.2 enableDomain(booking) → booking features visible in GET /api/v1/features', async () => {
      if (SKIP_GATE) return;
      await enableDomain(TOKEN_GATE, 'booking');
      const data = await getFeatures(TOKEN_GATE);
      expect(data.domains).toContain('booking');
      expect(data.features).toContain('booking.availability');
      expect(data.features).toContain('booking.core');
    });

    it('B.3 disableDomain(booking) → booking features disappear from GET /api/v1/features', async () => {
      if (SKIP_GATE) return;
      // State: booking was just enabled in B.2
      await disableDomain(TOKEN_GATE, 'booking');
      const data = await getFeatures(TOKEN_GATE);
      expect(data.domains).not.toContain('booking');
      expect(data.features).not.toContain('booking.availability');
      expect(data.features).not.toContain('booking.core');
    });

    it('B.4 voice features unaffected by booking domain toggle', async () => {
      if (SKIP_GATE) return;
      // Voice domain should remain enabled throughout
      const data = await getFeatures(TOKEN_GATE);
      expect(data.domains).toContain('voice');
      expect(data.features).toContain('voice.core');
      expect(data.features).toContain('voice.callback');
    });
  });

  // ── C. Cache invalidation — observable behavior ───────────────────────────

  describe('C. Cache invalidation — state changes visible immediately', () => {
    if (SKIP_GATE) {
      it.skip('TOKEN_FEATURE_GATE_TENANT not set — section C skipped', () => {});
    }

    beforeAll(async () => {
      if (SKIP_GATE) return;
      await restoreGateTenantBaseline();
    });

    afterAll(async () => {
      if (SKIP_GATE) return;
      await restoreGateTenantBaseline();
    });

    it('C.1 enableDomain → new features visible on next read (no 60s wait)', async () => {
      if (SKIP_GATE) return;
      const before = await getFeatures(TOKEN_GATE);
      expect(before.features).not.toContain('booking.core');

      await enableDomain(TOKEN_GATE, 'booking');

      const after = await getFeatures(TOKEN_GATE);
      expect(after.features).toContain('booking.core');
    });

    it('C.2 disableDomain → features gone on next read (no 60s wait)', async () => {
      if (SKIP_GATE) return;
      // State: booking enabled from C.1
      await disableDomain(TOKEN_GATE, 'booking');

      const after = await getFeatures(TOKEN_GATE);
      expect(after.features).not.toContain('booking.core');
    });

    it('C.3 enableFeature → feature visible on next read', async () => {
      if (SKIP_GATE) return;
      // Ensure booking.availability is disabled first
      await disableFeature(TOKEN_GATE, 'booking.availability');
      // booking domain must be enabled for the feature to appear (domain consistency)
      await enableDomain(TOKEN_GATE, 'booking');

      const before = await getFeatures(TOKEN_GATE);
      expect(before.features).toContain('booking.availability'); // domain enabled → it's visible

      // Disable → re-enable to test the toggle
      await disableFeature(TOKEN_GATE, 'booking.availability');
      const mid = await getFeatures(TOKEN_GATE);
      expect(mid.features).not.toContain('booking.availability');

      await enableFeature(TOKEN_GATE, 'booking.availability');
      const after = await getFeatures(TOKEN_GATE);
      expect(after.features).toContain('booking.availability');
    });

    it('C.4 disableFeature → feature gone on next read', async () => {
      if (SKIP_GATE) return;
      // State: booking domain enabled, booking.availability enabled (from C.3)
      await disableFeature(TOKEN_GATE, 'booking.availability');

      const after = await getFeatures(TOKEN_GATE);
      expect(after.features).not.toContain('booking.availability');
    });
  });

  // ── D. /api/v1/features?verbose=true ──────────────────────────────────────

  describe('D. /api/v1/features?verbose=true', () => {
    // D1–D2: shape tests — use TOKEN_A (always available)
    describe('D.1–D.2 Response shape (Tenant A)', () => {
      let defaultData;
      let verboseData;

      beforeAll(async () => {
        [defaultData, verboseData] = await Promise.all([
          getFeatures(TOKEN_A),
          getVerbose(TOKEN_A),
        ]);
      });

      it('D.1 default response: features is string[]', () => {
        expect(Array.isArray(defaultData.features)).toBe(true);
        expect(typeof defaultData.features[0]).toBe('string');
      });

      it('D.1 default response: domains is string[]', () => {
        expect(Array.isArray(defaultData.domains)).toBe(true);
        expect(typeof defaultData.domains[0]).toBe('string');
      });

      it('D.2 verbose response: features is [{key, enabled}]', () => {
        expect(Array.isArray(verboseData.features)).toBe(true);
        const first = verboseData.features[0];
        expect(typeof first.key).toBe('string');
        expect(typeof first.enabled).toBe('boolean');
      });

      it('D.2 verbose response: domains is [{key, name, enabled}]', () => {
        expect(Array.isArray(verboseData.domains)).toBe(true);
        const first = verboseData.domains[0];
        expect(typeof first.key).toBe('string');
        expect(typeof first.name).toBe('string');
        expect(typeof first.enabled).toBe('boolean');
      });

      it('D.2 verbose features contain same keys as default for enabled features', () => {
        const verboseEnabledKeys = verboseData.features
          .filter((f) => f.enabled)
          .map((f) => f.key)
          .sort();
        const defaultKeys = [...defaultData.features].sort();
        expect(verboseEnabledKeys).toEqual(defaultKeys);
      });
    });

    // D3–D4: disabled-entry behavior — requires TOKEN_FEATURE_GATE_TENANT
    describe('D.3–D.4 Disabled entries (feature gate tenant)', () => {
      if (SKIP_GATE) {
        it.skip('TOKEN_FEATURE_GATE_TENANT not set — D.3–D.4 skipped', () => {});
      }

      beforeAll(async () => {
        if (SKIP_GATE) return;
        // Ensure booking.availability is disabled
        await disableFeature(TOKEN_GATE, 'booking.availability');
        // booking domain needs to exist in tenant_domains for verbose to return it
        // enable domain so the domain row exists, then we can test its enabled state
        // Actually, for D.3 we need the feature row to exist (it does from migration)
        // The domain may not exist in tenant_domains at all
        // Enable + disable booking domain so it exists with enabled_at = null
        await enableDomain(TOKEN_GATE, 'booking');
        await disableDomain(TOKEN_GATE, 'booking');
      });

      afterAll(async () => {
        if (SKIP_GATE) return;
        await restoreGateTenantBaseline();
      });

      it('D.3 disabled feature (booking.availability) appears in verbose with enabled=false', async () => {
        if (SKIP_GATE) return;
        const data = await getVerbose(TOKEN_GATE);
        const featureEntry = data.features.find((f) => f.key === 'booking.availability');
        expect(featureEntry).toBeDefined();
        expect(featureEntry.enabled).toBe(false);
      });

      it('D.4 disabled feature absent from default GET /api/v1/features', async () => {
        if (SKIP_GATE) return;
        const data = await getFeatures(TOKEN_GATE);
        expect(data.features).not.toContain('booking.availability');
      });

      it('D.4 disabled domain appears in verbose with enabled=false', async () => {
        if (SKIP_GATE) return;
        const data = await getVerbose(TOKEN_GATE);
        const domainEntry = data.domains.find((d) => d.key === 'booking');
        expect(domainEntry).toBeDefined();
        expect(domainEntry.enabled).toBe(false);
      });

      it('D.4 disabled domain absent from default domains list', async () => {
        if (SKIP_GATE) return;
        const data = await getFeatures(TOKEN_GATE);
        expect(data.domains).not.toContain('booking');
      });
    });
  });

  // ── E. Tenant isolation ───────────────────────────────────────────────────

  describe('E. Tenant isolation — mutations on one tenant do not affect another', () => {
    if (SKIP_GATE) {
      it.skip('TOKEN_FEATURE_GATE_TENANT not set — section E skipped', () => {});
    }

    afterAll(async () => {
      if (SKIP_GATE) return;
      // Restore: re-enable voice.core for feature gate tenant if it was disabled
      await enableFeature(TOKEN_GATE, 'voice.core');
    });

    it('E.1 disableFeature on gate tenant does not remove feature from Tenant A', async () => {
      if (SKIP_GATE) return;
      // Pre-check: Tenant A has voice.core
      const before = await getFeatures(TOKEN_A);
      expect(before.features).toContain('voice.core');

      // Gate tenant disables voice.core for itself
      await disableFeature(TOKEN_GATE, 'voice.core');

      // Tenant A must still have voice.core
      const after = await getFeatures(TOKEN_A);
      expect(after.features).toContain('voice.core');
    });

    it('E.2 gate tenant itself no longer has voice.core after disabling', async () => {
      if (SKIP_GATE) return;
      const data = await getFeatures(TOKEN_GATE);
      expect(data.features).not.toContain('voice.core');
    });

    it('E.3 enableFeature restores gate tenant voice.core without affecting Tenant A', async () => {
      if (SKIP_GATE) return;
      await enableFeature(TOKEN_GATE, 'voice.core');
      const [gateData, tenantAData] = await Promise.all([
        getFeatures(TOKEN_GATE),
        getFeatures(TOKEN_A),
      ]);
      expect(gateData.features).toContain('voice.core');
      expect(tenantAData.features).toContain('voice.core');
    });
  });

  // ── F. Runtime gating after toggle (VAPI webhook path) ───────────────────

  describe('F. Runtime gating — feature toggle reflected in tool dispatch', () => {
    if (SKIP_WEBHOOK) {
      it.skip(
        'TOKEN_FEATURE_GATE_TENANT or VAPI_FEATURE_GATE_ASSISTANT_ID not set — section F skipped',
        () => {},
      );
    }

    beforeAll(async () => {
      if (SKIP_WEBHOOK) return;
      // Ensure baseline: booking.availability disabled
      await disableFeature(TOKEN_GATE, 'booking.availability');
      // Disable booking domain too so domain consistency doesn't interfere
      await disableDomain(TOKEN_GATE, 'booking');
    });

    afterAll(async () => {
      if (SKIP_WEBHOOK) return;
      await restoreGateTenantBaseline();
    });

    it('F.1 check_availability blocked when booking.availability disabled', async () => {
      if (SKIP_WEBHOOK) return;
      const callId = await startCall(VAPI_FEATURE_GATE_ASSISTANT_ID);
      const result = await dispatchTool(callId, 'check_availability', {
        date: '2026-04-21',
        time: '10:00',
        duration_minutes: 30,
      }, VAPI_FEATURE_GATE_ASSISTANT_ID);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/booking\.availability/);
      expect(result.error).toMatch(/not enabled/i);
    });

    it('F.2 check_availability NOT feature-blocked after enabling booking domain', async () => {
      if (SKIP_WEBHOOK) return;
      // Enable booking domain (provisions + enables booking.availability)
      await enableDomain(TOKEN_GATE, 'booking');

      const callId = await startCall(VAPI_FEATURE_GATE_ASSISTANT_ID);
      const result = await dispatchTool(callId, 'check_availability', {
        date: '2026-04-21',
        time: '10:00',
        duration_minutes: 30,
      }, VAPI_FEATURE_GATE_ASSISTANT_ID);

      // The tool may fail for business reasons (missing booking context etc.)
      // but MUST NOT fail because of the feature gate
      if (!result.success) {
        expect(result.error).not.toMatch(/not enabled/i);
        expect(result.error).not.toMatch(/booking\.availability/i);
      }
    });

    it('F.3 check_availability blocked again after disabling booking domain', async () => {
      if (SKIP_WEBHOOK) return;
      // Disable booking domain
      await disableDomain(TOKEN_GATE, 'booking');

      const callId = await startCall(VAPI_FEATURE_GATE_ASSISTANT_ID);
      const result = await dispatchTool(callId, 'check_availability', {
        date: '2026-04-21',
        time: '10:00',
        duration_minutes: 30,
      }, VAPI_FEATURE_GATE_ASSISTANT_ID);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/booking\.availability/);
      expect(result.error).toMatch(/not enabled/i);
    });

    it('F.4 create_callback_request (voice.callback) passes gate throughout', async () => {
      if (SKIP_WEBHOOK) return;
      // voice.callback should remain enabled regardless of booking domain toggles
      const callId = await startCall(VAPI_FEATURE_GATE_ASSISTANT_ID);
      const result = await dispatchTool(callId, 'create_callback_request', {
        caller_number: '+49 170 0000001',
      }, VAPI_FEATURE_GATE_ASSISTANT_ID);

      // Must NOT be blocked by feature gate
      if (!result.success) {
        expect(result.error).not.toMatch(/not enabled/i);
        expect(result.error).not.toMatch(/voice\.callback/i);
      }
    });
  });

});
