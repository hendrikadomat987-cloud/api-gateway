'use strict';

/**
 * Voice — Feature Gating
 *
 * Verifies that the two-layer tool dispatch gate (track → feature) works
 * correctly at runtime:
 *
 *   A. Tenant A (booking + restaurant, NO salon) — salon tools are blocked
 *   B. Tenant A — booking tools pass through (feature enabled)
 *   C. Tenant A — restaurant tools pass through (feature enabled)
 *   D. Tenant B (voice only, NO booking/restaurant) — booking tools blocked
 *   E. Salon tenant — salon tools pass through (feature enabled)
 *   F. Salon tenant — restaurant tools are blocked (wrong track, not feature)
 *
 * Note: "blocked" here means tool dispatch returns success:false with a
 * feature-not-enabled or track-not-allowed error, NOT an HTTP error.
 * The VAPI webhook always returns HTTP 200 with per-tool results.
 */

const config = require('../../config/config');
const { sendVoiceWebhook, listVoiceCalls } = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_RESTAURANT_ASSISTANT_ID,
  VAPI_SALON_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(60000);

const TOKEN_A    = config.tokens.tenantA;
const TOKEN_B    = config.tokens.tenantB;
const TOKEN_SALON = config.tokens.tenantSalon;

// Default booking assistant used by Tenant A
const BOOKING_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID || process.env.VAPI_BOOKING_ASSISTANT_ID || '';

async function startCall(assistantId) {
  const callId = uniqueVoiceCallId('feat-gate');
  const res = await sendVoiceWebhook(buildVapiStatusUpdate(callId, {}, assistantId));
  if (res.status >= 300) throw new Error(`Setup failed: HTTP ${res.status}`);
  return callId;
}

async function callTool(callId, toolName, args, assistantId) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, toolName, args, assistantId),
  );
  expect(res.status).toBe(200);
  const results = res.data?.results;
  expect(Array.isArray(results)).toBe(true);
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / feature / gating', () => {
  // ── A. Tenant A — salon tools blocked ──────────────────────────────────────

  describe('A. Tenant A — salon tools blocked (no salon domain)', () => {
    let callId;

    beforeAll(async () => {
      if (!BOOKING_ASSISTANT_ID) {
        console.warn('  ⚠ VAPI_ASSISTANT_ID not set — skipping section A');
        return;
      }
      callId = await startCall(BOOKING_ASSISTANT_ID);
    });

    it('get_services returns not-allowed (wrong track for booking)', async () => {
      if (!BOOKING_ASSISTANT_ID) return;
      // get_services is a salon tool; booking track doesn't have it
      const result = await callTool(callId, 'get_services', {}, BOOKING_ASSISTANT_ID);
      expect(result).toBeDefined();
      // Track-level block: tool not in BOOKING_TOOLS registry
      expect(result.success).toBe(false);
    });
  });

  // ── B. Tenant A — booking tools pass through ───────────────────────────────

  describe('B. Tenant A — booking tools accessible', () => {
    let callId;

    beforeAll(async () => {
      if (!BOOKING_ASSISTANT_ID) {
        console.warn('  ⚠ VAPI_ASSISTANT_ID not set — skipping section B');
        return;
      }
      callId = await startCall(BOOKING_ASSISTANT_ID);
    });

    it('check_availability executes (no feature block)', async () => {
      if (!BOOKING_ASSISTANT_ID) return;
      // We pass minimal args — the tool may fail for business reasons
      // but must NOT fail with a feature-not-enabled error
      const result = await callTool(callId, 'check_availability', {
        date: '2026-04-14',
        time: '10:00',
        duration_minutes: 30,
      }, BOOKING_ASSISTANT_ID);
      // Should not be feature-blocked
      if (!result.success) {
        expect(result.error).not.toMatch(/Feature.*not enabled/i);
        expect(result.error).not.toMatch(/VOICE_FEATURE_NOT_ENABLED/i);
      }
    });
  });

  // ── C. Tenant A — restaurant tools pass through ────────────────────────────

  describe('C. Tenant A — restaurant tools accessible', () => {
    let callId;

    beforeAll(async () => {
      if (!VAPI_RESTAURANT_ASSISTANT_ID) {
        console.warn('  ⚠ VAPI_RESTAURANT_ASSISTANT_ID not set — skipping section C');
        return;
      }
      callId = await startCall(VAPI_RESTAURANT_ASSISTANT_ID);
    });

    it('get_menu executes (no feature block)', async () => {
      if (!VAPI_RESTAURANT_ASSISTANT_ID) return;
      const result = await callTool(callId, 'get_menu', {}, VAPI_RESTAURANT_ASSISTANT_ID);
      if (!result.success) {
        expect(result.error).not.toMatch(/Feature.*not enabled/i);
        expect(result.error).not.toMatch(/VOICE_FEATURE_NOT_ENABLED/i);
      }
    });
  });

  // ── D. Tenant B — booking tools blocked (voice-only domain) ───────────────

  describe('D. Tenant B — booking tools blocked (voice-only tenant)', () => {
    // Tenant B only has voice domain → booking.core is not enabled
    // We cannot easily start a call as Tenant B via VAPI webhook because the
    // assistant_id maps to Tenant A. This section tests the /features endpoint
    // indirectly: if Tenant B has no booking features, the tool gate fires.
    //
    // Skip if we have no way to distinguish Tenant B's assistant.
    it('Tenant B features endpoint shows no booking domain', async () => {
      const { getTenantFeatures } = require('../../core/apiClient');
      const res = await getTenantFeatures(TOKEN_B);
      expect(res.status).toBe(200);
      const { features, domains } = res.data.data;
      // Tenant B is voice-only — should NOT have booking, restaurant, or salon
      expect(domains).not.toContain('booking');
      expect(domains).not.toContain('restaurant');
      expect(domains).not.toContain('salon');
      // Must have voice
      expect(domains).toContain('voice');
      // Must have voice.core feature
      expect(features).toContain('voice.core');
      // Must NOT have booking features
      expect(features).not.toContain('booking.core');
      expect(features).not.toContain('restaurant.core');
      expect(features).not.toContain('salon.core');
    });
  });

  // ── E. Salon tenant — salon tools pass through ─────────────────────────────

  describe('E. Salon tenant — salon tools accessible', () => {
    let callId;

    beforeAll(async () => {
      if (!VAPI_SALON_ASSISTANT_ID) {
        console.warn('  ⚠ VAPI_SALON_ASSISTANT_ID not set — skipping section E');
        return;
      }
      callId = await startCall(VAPI_SALON_ASSISTANT_ID);
    });

    it('get_services executes (no feature block)', async () => {
      if (!VAPI_SALON_ASSISTANT_ID) return;
      const result = await callTool(callId, 'get_services', {}, VAPI_SALON_ASSISTANT_ID);
      // Tool should execute — success or business error, NOT feature error
      if (!result.success) {
        expect(result.error).not.toMatch(/Feature.*not enabled/i);
      }
    });
  });

  // ── F. Salon tenant — restaurant tools blocked (wrong track) ──────────────

  describe('F. Salon tenant — restaurant tools blocked (track mismatch)', () => {
    let callId;

    beforeAll(async () => {
      if (!VAPI_SALON_ASSISTANT_ID) {
        console.warn('  ⚠ VAPI_SALON_ASSISTANT_ID not set — skipping section F');
        return;
      }
      callId = await startCall(VAPI_SALON_ASSISTANT_ID);
    });

    it('get_menu returns not-allowed (not in salon TOOL_REGISTRY)', async () => {
      if (!VAPI_SALON_ASSISTANT_ID) return;
      const result = await callTool(callId, 'get_menu', {}, VAPI_SALON_ASSISTANT_ID);
      expect(result.success).toBe(false);
      // Track-level block message
      expect(result.error).toMatch(/not allowed in track/i);
    });
  });
});
