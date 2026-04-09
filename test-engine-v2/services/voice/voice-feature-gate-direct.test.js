'use strict';

/**
 * Voice — Feature Gate: Direct Layer-2 Tests
 *
 * Tests the Layer-2 feature gate in resolve-tool.ts via the real VAPI webhook
 * dispatch path — not via the /api/v1/features endpoint.
 *
 * Test tenant: 44444444-4444-4444-4444-444444444444 (seeded by migration 20260410000001)
 *   • Booking-track voice agent (VAPI_FEATURE_GATE_ASSISTANT_ID)
 *   • voice domain only → voice.core + voice.callback enabled
 *   • booking.availability in tenant_features with is_enabled = false
 *
 * Layer-2 contract:
 *   A tool that is registered in TOOL_REGISTRY for the current track (Layer 1 passes)
 *   but whose required feature is absent or disabled for the tenant (Layer 2 fails)
 *   must return:
 *     { success: false, error: "Feature '<key>' is not enabled for this tenant." }
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Test sections:
 *
 *   A. Layer-2 block — check_availability (requires booking.availability, disabled)
 *      Sends a real VAPI tool-call webhook. Expects per-tool blocked result.
 *
 *   B. Layer-2 block — get_next_free (also requires booking.availability, disabled)
 *      Confirms that all tools sharing a feature key are consistently gated.
 *
 *   C. Layer-1 passes + Layer-2 passes — create_callback_request (voice.callback enabled)
 *      Verifies the gate only blocks what it should. The tool may still fail for
 *      business reasons (missing session data), but must NOT fail with a feature error.
 *
 *   D. is_enabled = false — /api/v1/features does not surface disabled features
 *      Requires TOKEN_FEATURE_GATE_TENANT env var. Skipped if absent.
 *      Verifies that booking.availability (is_enabled = false) is absent from the
 *      features list, while voice.core / voice.callback appear normally.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Prerequisites:
 *   • Migration 20260410000001_test_feature_gate_tenant.sql applied
 *   • VAPI_FEATURE_GATE_ASSISTANT_ID set (default: 'test-feature-gate-assistant-001')
 *   • TOKEN_FEATURE_GATE_TENANT optional (only for section D)
 */

const config = require('../../config/config');
const { sendVoiceWebhook, getTenantFeatures } = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_FEATURE_GATE_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(30000);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function startCall(assistantId) {
  const callId = uniqueVoiceCallId('feat-gate-l2');
  const res = await sendVoiceWebhook(buildVapiStatusUpdate(callId, {}, assistantId));
  if (res.status >= 300) throw new Error(`Call setup failed: HTTP ${res.status}`);
  return callId;
}

/**
 * Sends a VAPI tool-call webhook and returns the first tool result.
 * The HTTP response is always 200 for VAPI; tool errors are inside results[].
 */
async function dispatchTool(callId, toolName, args, assistantId) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, toolName, args, assistantId),
  );
  expect(res.status).toBe(200);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`No results in response for tool '${toolName}'`);
  }
  return results[0].result;
}

// ── Skip guard ────────────────────────────────────────────────────────────────

const SKIP_WEBHOOK = !VAPI_FEATURE_GATE_ASSISTANT_ID;

if (SKIP_WEBHOOK) {
  console.warn(
    '\n  ⚠ voice-feature-gate-direct: VAPI_FEATURE_GATE_ASSISTANT_ID not set. ' +
    'Sections A–C are skipped. Apply migration 20260410000001 and set the env var.\n',
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / feature / gate-direct', () => {
  // ── A. Layer-2 block: check_availability ────────────────────────────────────

  describe('A. Layer-2 block — check_availability (booking.availability disabled)', () => {
    let callId;

    beforeAll(async () => {
      if (SKIP_WEBHOOK) return;
      callId = await startCall(VAPI_FEATURE_GATE_ASSISTANT_ID);
    });

    it('returns success=false with feature-not-enabled message', async () => {
      if (SKIP_WEBHOOK) return;

      const result = await dispatchTool(callId, 'check_availability', {
        date: '2026-04-21',
        time: '10:00',
        duration_minutes: 30,
      }, VAPI_FEATURE_GATE_ASSISTANT_ID);

      // Layer-2 contract
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/booking\.availability/);
      expect(result.error).toMatch(/not enabled/i);
    });

    it('error does NOT mention track or TOOL_REGISTRY (it is a feature block, not track block)', async () => {
      if (SKIP_WEBHOOK) return;

      const result = await dispatchTool(
        callId, 'check_availability',
        { date: '2026-04-21', time: '10:00', duration_minutes: 30 },
        VAPI_FEATURE_GATE_ASSISTANT_ID,
      );

      // Track-level error message pattern — must NOT appear
      expect(result.error).not.toMatch(/not allowed in track/i);
    });
  });

  // ── B. Layer-2 block: get_next_free (same feature requirement) ──────────────

  describe('B. Layer-2 block — get_next_free (also requires booking.availability)', () => {
    let callId;

    beforeAll(async () => {
      if (SKIP_WEBHOOK) return;
      callId = await startCall(VAPI_FEATURE_GATE_ASSISTANT_ID);
    });

    it('returns success=false — same feature key blocks both availability tools', async () => {
      if (SKIP_WEBHOOK) return;

      const result = await dispatchTool(callId, 'get_next_free', {
        duration_minutes: 30,
      }, VAPI_FEATURE_GATE_ASSISTANT_ID);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/booking\.availability/);
      expect(result.error).toMatch(/not enabled/i);
    });
  });

  // ── C. Layer-1+2 pass: create_callback_request (voice.callback enabled) ─────

  describe('C. Feature present — create_callback_request passes Layer-2 (voice.callback enabled)', () => {
    let callId;

    beforeAll(async () => {
      if (SKIP_WEBHOOK) return;
      callId = await startCall(VAPI_FEATURE_GATE_ASSISTANT_ID);
    });

    it('does NOT return a feature-not-enabled error', async () => {
      if (SKIP_WEBHOOK) return;

      // create_callback_request requires voice.callback, which IS enabled.
      // The tool may still fail for business reasons (missing booking context)
      // but MUST NOT fail because of the feature gate.
      const result = await dispatchTool(callId, 'create_callback_request', {
        caller_number: '+49 170 0000001',
      }, VAPI_FEATURE_GATE_ASSISTANT_ID);

      // Feature gate must not fire
      if (!result.success) {
        expect(result.error).not.toMatch(/not enabled/i);
        expect(result.error).not.toMatch(/booking\.availability/);
        expect(result.error).not.toMatch(/voice\.callback/);
      }
    });
  });

  // ── D. is_enabled = false — /api/v1/features excludes disabled entries ───────

  describe('D. is_enabled = false — not surfaced by /api/v1/features', () => {
    const TOKEN = config.tokens.tenantFeatureGate;

    beforeAll(() => {
      if (!TOKEN) {
        console.warn(
          '  ⚠ TOKEN_FEATURE_GATE_TENANT not set — section D skipped.\n' +
          '    Generate a JWT with org_id=44444444-4444-4444-4444-444444444444\n' +
          '    and set TOKEN_FEATURE_GATE_TENANT in test-engine-v2/.env',
        );
      }
    });

    it('booking.availability (is_enabled=false) is absent from features list', async () => {
      if (!TOKEN) return;

      const res = await getTenantFeatures(TOKEN);
      expect(res.status).toBe(200);

      const { features } = res.data.data;

      // Disabled feature must NOT appear
      expect(features).not.toContain('booking.availability');
    });

    it('voice.core and voice.callback (is_enabled=true) are present', async () => {
      if (!TOKEN) return;

      const res = await getTenantFeatures(TOKEN);
      expect(res.status).toBe(200);

      const { features } = res.data.data;

      expect(features).toContain('voice.core');
      expect(features).toContain('voice.callback');
    });

    it('booking domain is absent from domains list (not provisioned)', async () => {
      if (!TOKEN) return;

      const res = await getTenantFeatures(TOKEN);
      expect(res.status).toBe(200);

      const { domains } = res.data.data;

      expect(domains).not.toContain('booking');
      expect(domains).toContain('voice');
    });
  });
});
