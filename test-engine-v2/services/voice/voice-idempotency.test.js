'use strict';

/**
 * Voice — Idempotency Test
 *
 * Verifies that sending the same end-of-call-report webhook twice:
 *   - does NOT create a duplicate event
 *   - does NOT mutate the call a second time
 *
 * Uses VOICE_CALL_ID_2 to stay isolated from full-flow tests (VOICE_CALL_ID_1).
 *
 * NOTE on internal UUID:
 *   GET /voice/calls/:id/events expects the internal voice_calls.id UUID,
 *   not the provider_call_id. We resolve it via GET /voice/calls first.
 *
 * Internal event type:
 *   end-of-call-report → stored as 'call.ended'
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCallEvents,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiEndOfCallReport,
  uniqueVoiceCallId,
} = require('../../core/factories');

const {
  expectSuccess,
  assertSingleEvent,
} = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN            = config.tokens.tenantA;
// One unique ID per run — reused for both duplicate sends (idempotency test)
const PROVIDER_CALL_ID = uniqueVoiceCallId('test-call-voice-idem');

/**
 * Resolve the internal voice_calls.id UUID from a provider_call_id.
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

// Freeze the payload so both sends use the identical timestamp (true idempotency test)
const END_OF_CALL_PAYLOAD = buildVapiEndOfCallReport(PROVIDER_CALL_ID);

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / idempotency', () => {
  let internalCallId;

  it('setup — status-update accepted (creates call)', async () => {
    const payload = buildVapiStatusUpdate(PROVIDER_CALL_ID);
    const res     = await sendVoiceWebhook(payload);
    expect(res.status).toBeLessThan(300);
  });

  it('setup — resolve internal call UUID', async () => {
    internalCallId = await findInternalCallId(TOKEN, PROVIDER_CALL_ID);
    if (!internalCallId) {
      throw new Error(
        `Cannot resolve internal call UUID after status-update.\n` +
        `provider_call_id: ${PROVIDER_CALL_ID}`
      );
    }
  });

  it('first end-of-call-report is accepted', async () => {
    const res = await sendVoiceWebhook(END_OF_CALL_PAYLOAD);

    expect(res.status).toBeLessThan(300);

    if (res.data && res.data.success === false) {
      throw new Error(
        `First end-of-call-report rejected.\nprovider_call_id: ${PROVIDER_CALL_ID}\n` +
        `Payload: ${JSON.stringify(END_OF_CALL_PAYLOAD)}\n` +
        `Response: ${JSON.stringify(res.data)}`
      );
    }
  });

  it('second identical end-of-call-report is accepted without error (idempotent)', async () => {
    // Same frozen payload — same timestamp — this is the duplicate
    const res = await sendVoiceWebhook(END_OF_CALL_PAYLOAD);

    // Backend must NOT return 5xx — duplicate is silently ignored
    expect(res.status).toBeLessThan(500);
  });

  it('only one call.ended event is stored (no duplicate mutation)', async () => {
    if (!internalCallId) return;

    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    try {
      // Internal event type mapped from 'end-of-call-report' → 'call.ended'
      assertSingleEvent(events, 'call.ended');
    } catch (err) {
      throw new Error(
        `Idempotency violated — duplicate event detected.\n` +
        `provider_call_id: ${PROVIDER_CALL_ID}\n` +
        `internal UUID: ${internalCallId}\n` +
        `Events: ${JSON.stringify(events.map((e) => e.event_type))}\n` +
        `Original: ${err.message}`
      );
    }
  });
});
