'use strict';

/**
 * Voice — Full Flow Test
 *
 * Tests the complete call lifecycle end-to-end:
 *   1. status-update webhook  → call + session created
 *   2. load call              → verify via internal UUID (resolved from provider_call_id)
 *   3. fallback               → SKIPPED — session UUID not discoverable via current API
 *   4. handover               → SKIPPED — session UUID not discoverable via current API
 *   5. end-of-call-report     → status = completed
 *   6. verify events          → event_ts / created_at, duration_seconds, summary
 *
 * NOTE on session tests (steps 3 + 4):
 *   GET /voice/calls/:id does NOT include a session_id field.
 *   GET /voice/sessions/:id requires the session UUID.
 *   There is no GET /voice/calls/:id/sessions endpoint.
 *   Fallback / handover can only be tested once a session-discovery route exists.
 *
 * NOTE on internal vs. provider IDs:
 *   GET /voice/calls/:id expects the internal UUID (voice_calls.id), NOT the
 *   provider_call_id. We resolve the internal UUID via GET /voice/calls first.
 *
 * Internal event types (after VAPI→internal mapping):
 *   status-update       → call.status_update
 *   end-of-call-report  → call.ended
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getVoiceCallEvents,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiEndOfCallReport,
  uniqueVoiceCallId,
} = require('../../core/factories');

const {
  expectSuccess,
  assertVoiceCallCompleted,
  assertEventExists,
  assertEventTimestamp,
} = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN           = config.tokens.tenantA;
const PROVIDER_CALL_ID = uniqueVoiceCallId('test-call-voice-full');

/**
 * Resolve the internal voice_calls.id UUID from a provider_call_id.
 * GET /voice/calls/:id requires the internal UUID — never the provider string.
 *
 * @param {string} token
 * @param {string} providerCallId
 * @returns {Promise<string|null>}
 */
async function findInternalCallId(token, providerCallId) {
  const res = await listVoiceCalls(token);
  if (res.status !== 200 || !res.data?.success) return null;
  const call = res.data.data.find((c) => c.provider_call_id === providerCallId);
  return call?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / full-flow', () => {
  let internalCallId;

  // ── Step 1: status-update ──────────────────────────────────────────────────

  it('step 1 — status-update webhook is accepted', async () => {
    const payload = buildVapiStatusUpdate(PROVIDER_CALL_ID);
    const res     = await sendVoiceWebhook(payload);

    expect(res.status).toBeLessThan(300);

    if (res.data && res.data.success === false) {
      throw new Error(
        `Webhook rejected.\nEndpoint: POST /voice/providers/vapi/webhook\n` +
        `Payload: ${JSON.stringify(payload)}\n` +
        `Response: ${JSON.stringify(res.data)}`
      );
    }
  });

  // ── Step 2: call exists — resolve internal UUID ────────────────────────────

  it('step 2 — call is listed and internal UUID resolves', async () => {
    internalCallId = await findInternalCallId(TOKEN, PROVIDER_CALL_ID);

    if (!internalCallId) {
      throw new Error(
        `Call not found in list after status-update.\n` +
        `provider_call_id: ${PROVIDER_CALL_ID}\n` +
        `Checked: GET /voice/calls`
      );
    }
  });

  it('step 2 — call is retrievable by internal UUID', async () => {
    if (!internalCallId) return; // depends on previous step

    const res  = await getVoiceCall(TOKEN, internalCallId);
    const call = expectSuccess(res);

    expect(call.id).toBe(internalCallId);
    expect(call.provider_call_id).toBe(PROVIDER_CALL_ID);
  });

  // ── Steps 3 + 4: fallback / handover — SKIPPED ────────────────────────────
  //
  // Session UUID is not exposed through the available API routes:
  //   - voice_calls rows have no session_id column
  //   - GET /voice/sessions/:id requires a known session UUID
  //   - There is no GET /voice/calls/:id/sessions endpoint
  //
  // These tests require a session-discovery route to be implemented first.

  // ── Step 5: end-of-call-report ─────────────────────────────────────────────

  it('step 5 — end-of-call-report webhook is accepted', async () => {
    const payload = buildVapiEndOfCallReport(PROVIDER_CALL_ID);
    const res     = await sendVoiceWebhook(payload);

    expect(res.status).toBeLessThan(300);

    if (res.data && res.data.success === false) {
      throw new Error(
        `end-of-call-report rejected.\nEndpoint: POST /voice/providers/vapi/webhook\n` +
        `provider_call_id: ${PROVIDER_CALL_ID}\n` +
        `Payload: ${JSON.stringify(payload)}\n` +
        `Response: ${JSON.stringify(res.data)}`
      );
    }
  });

  // ── Step 6: verify final state ─────────────────────────────────────────────

  it('step 6 — call status is completed with duration_seconds and summary', async () => {
    if (!internalCallId) return;

    const res  = await getVoiceCall(TOKEN, internalCallId);
    const call = expectSuccess(res);

    try {
      assertVoiceCallCompleted(call);
    } catch (err) {
      throw new Error(
        `Call not in expected completed state.\n` +
        `internal UUID: ${internalCallId}\n` +
        `provider_call_id: ${PROVIDER_CALL_ID}\n` +
        `Call data: ${JSON.stringify(call)}\n` +
        `Original: ${err.message}`
      );
    }
  });

  it('step 6 — call.ended event exists with valid timestamps', async () => {
    if (!internalCallId) return;

    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    try {
      // Internal event type mapped from 'end-of-call-report' → 'call.ended'
      const eocr = assertEventExists(events, 'call.ended');
      assertEventTimestamp(eocr);
    } catch (err) {
      throw new Error(
        `call.ended event assertion failed.\n` +
        `internal UUID: ${internalCallId}\n` +
        `Events: ${JSON.stringify(events.map((e) => e.event_type))}\n` +
        `Original: ${err.message}`
      );
    }
  });

  it('step 6 — call.status_update event exists with valid timestamps', async () => {
    if (!internalCallId) return;

    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    try {
      // Internal event type mapped from 'status-update' → 'call.status_update'
      const su = assertEventExists(events, 'call.status_update');
      assertEventTimestamp(su);
    } catch (err) {
      throw new Error(
        `call.status_update event assertion failed.\n` +
        `internal UUID: ${internalCallId}\n` +
        `Events: ${JSON.stringify(events.map((e) => e.event_type))}\n` +
        `Original: ${err.message}`
      );
    }
  });
});
