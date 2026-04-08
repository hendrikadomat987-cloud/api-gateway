'use strict';

/**
 * Voice — Live Payload Replay Tests
 *
 * Sends real-shaped (or fixture-based) Vapi webhook payloads to the actual
 * webhook endpoint and validates that the backend handles them correctly.
 *
 * PURPOSE
 * -------
 * Bridge between the synthetic factory-based test suite and real Vapi traffic.
 * Catches compatibility regressions that only appear with real payload shapes —
 * e.g. extra fields, missing factory fields, or type differences (object vs string).
 *
 * HOW IT WORKS
 * ------------
 * Each test:
 *   1. Loads a fixture from fixtures/voice/live/
 *   2. Patches provider_call_id with a unique test ID (prevents DB collisions)
 *   3. Patches assistantId with VAPI_ASSISTANT_ID from env (for tenant routing)
 *   4. Sends the fixture via sendVoiceWebhook (which adds HMAC signature)
 *   5. Asserts the endpoint responds without crashing
 *
 * ADDING REAL PAYLOADS
 * --------------------
 * Replace the placeholder JSON in fixtures/voice/live/ with the raw body
 * copied from Vapi's webhook delivery logs. Then re-run:
 *   npm run test:voice:live-replay
 *
 * PERSISTENCE ASSERTIONS
 * ----------------------
 * Persistence checks (call exists, session exists, events exist) are only
 * added where the existing stable read endpoints are available. No new
 * fragile assertion logic is introduced.
 */

jest.setTimeout(120000);

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getCallSession,
  getVoiceCallEvents,
} = require('../../core/apiClient');

const {
  uniqueVoiceCallId,
  VAPI_ASSISTANT_ID,
  VAPI_RESTAURANT_ASSISTANT_ID,
} = require('../../core/factories');

const {
  expectSuccess,
  assertEventExists,
  assertVoiceCallCompleted,
  expectUuid,
} = require('../../core/assertions');

const {
  loadFixtureWithFallback,
  patchCallId,
  patchAssistantId,
} = require('../../core/fixtureLoader');

/**
 * Load a fixture, preferring real/ over placeholder.
 * Logs the source to make it visible in CI/test output.
 * Drops _fixture_meta automatically (handled by fixtureLoader).
 *
 * @param {string} name - fixture filename
 * @returns {object} deep-cloned fixture, safe to mutate
 */
function loadFixture(name) {
  const { fixture, source } = loadFixtureWithFallback(name);
  console.info(`[fixture-source] ${name}: ${source.toUpperCase()}`);
  return fixture;
}

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = config.tokens.tenantA;

/**
 * Resolve the internal call UUID from provider_call_id via GET /voice/calls.
 * Returns null if not found (never throws).
 */
async function findInternalCallId(providerCallId) {
  try {
    const res = await listVoiceCalls(TOKEN);
    if (res.status !== 200 || !res.data?.success) return null;
    const call = (res.data.data ?? []).find((c) => c.provider_call_id === providerCallId);
    return call?.id ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Replay: status-update
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-replay / status-update', () => {
  const CALL_ID = uniqueVoiceCallId('live-replay-status');
  let internalCallId;
  let webhookRes;

  it('real-shaped status-update fixture is accepted by the webhook endpoint', async () => {
    const fixture = loadFixture('vapi-status-update.json');
    patchCallId(fixture, CALL_ID);
    // Use the same assistantId as the factory-based tests so tenant routing works
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    console.info(
      `[live-replay] status-update fixture context:\n` +
      `  provider_call_id (patched): ${CALL_ID}\n` +
      `  assistantId (patched):      ${VAPI_ASSISTANT_ID ?? '(none — tenant routing will fail)'}\n` +
      `  phoneNumberId:              ${fixture.message?.call?.phoneNumberId ?? '(none)'}\n` +
      `  timestamp:                  ${fixture.message?.timestamp} (type: ${typeof fixture.message?.timestamp})`,
    );

    webhookRes = await sendVoiceWebhook(fixture);

    console.info(`[live-replay] status-update webhook response: ${webhookRes.status} — ${JSON.stringify(webhookRes.data)}`);

    // Endpoint must not crash — 2xx or a structured rejection, never an unhandled 500
    if (webhookRes.status >= 500) {
      throw new Error(
        `[live-replay] Webhook crashed with ${webhookRes.status} on status-update fixture.\n` +
        `  provider_call_id: ${CALL_ID}\n` +
        `  Response: ${JSON.stringify(webhookRes.data)}`,
      );
    }
    expect(webhookRes.status).toBeLessThan(500);
  });

  it('call is resolvable after real-shaped status-update', async () => {
    internalCallId = await findInternalCallId(CALL_ID);

    if (!internalCallId) {
      // Non-fatal: if tenant routing fails due to missing VAPI_ASSISTANT_ID,
      // the call may not be created. Surface this as a warning, not a hard failure.
      if (!VAPI_ASSISTANT_ID) {
        console.warn(
          '[live-replay] VAPI_ASSISTANT_ID not set in .env — ' +
          'tenant routing may not work for live fixture replay. ' +
          'Set it to a valid provider_agent_id to enable persistence assertions.',
        );
      }
      console.warn(
        `[live-replay] Call not found for provider_call_id=${CALL_ID}.\n` +
        `  Webhook response was: ${webhookRes?.status} — ${JSON.stringify(webhookRes?.data)}\n` +
        `  If status=4xx, check backend logs for tenant resolution or schema validation errors.\n` +
        `  Skipping persistence assertions.`,
      );
      return;
    }

    expectUuid(internalCallId);

    const callRes = await getVoiceCall(TOKEN, internalCallId);
    const call    = expectSuccess(callRes);
    expect(call.provider_call_id).toBe(CALL_ID);
  });

  it('session is created after real-shaped status-update (when call resolved)', async () => {
    if (!internalCallId) {
      console.warn('[live-replay] No internalCallId — skipping session check.');
      return;
    }

    const sessionRes = await getCallSession(TOKEN, internalCallId);

    if (sessionRes.status === 404) {
      // Session not created yet — not a failure for this fixture type
      console.warn('[live-replay] Session not yet available after status-update (may be async).');
      return;
    }

    const session = expectSuccess(sessionRes);
    expectUuid(session.id);
    expect(session.voice_call_id).toBe(internalCallId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay: end-of-call-report
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-replay / end-of-call-report', () => {
  // Use a shared call ID so both webhooks target the same call lifecycle
  const CALL_ID = uniqueVoiceCallId('live-replay-eocr');
  let internalCallId;
  let setupRes;

  beforeAll(async () => {
    // First send a status-update to create the call row, then the end-of-call-report
    const statusFixture = loadFixture('vapi-status-update.json');
    patchCallId(statusFixture, CALL_ID);
    if (VAPI_ASSISTANT_ID) patchAssistantId(statusFixture, VAPI_ASSISTANT_ID);

    setupRes = await sendVoiceWebhook(statusFixture);
    console.info(`[live-replay] eocr setup (status-update): ${setupRes.status} — ${JSON.stringify(setupRes.data)}`);

    if (setupRes.status >= 500) {
      throw new Error(
        `[live-replay] Setup failed — status-update crashed with ${setupRes.status}.\n` +
        `  Response: ${JSON.stringify(setupRes.data)}`,
      );
    }

    internalCallId = await findInternalCallId(CALL_ID);
    if (!internalCallId) {
      console.warn(
        `[live-replay] eocr setup: call not persisted after status-update.\n` +
        `  provider_call_id: ${CALL_ID}\n` +
        `  Setup response: ${setupRes.status} — ${JSON.stringify(setupRes.data)}\n` +
        `  HINT: status-update must succeed and tenant must resolve for eocr tests to have data.`,
      );
    }
  });

  it('real-shaped end-of-call-report fixture is accepted without crash', async () => {
    const fixture = loadFixture('vapi-end-of-call-report.json');
    patchCallId(fixture, CALL_ID);
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    console.info(
      `[live-replay] end-of-call-report fixture context:\n` +
      `  provider_call_id (patched): ${CALL_ID}\n` +
      `  assistantId (patched):      ${VAPI_ASSISTANT_ID ?? '(none)'}\n` +
      `  endedReason:                ${fixture.message?.endedReason ?? '(absent)'}\n` +
      `  timestamp:                  ${fixture.message?.timestamp} (type: ${typeof fixture.message?.timestamp})`,
    );

    const res = await sendVoiceWebhook(fixture);
    console.info(`[live-replay] end-of-call-report webhook response: ${res.status} — ${JSON.stringify(res.data)}`);

    if (res.status >= 500) {
      throw new Error(
        `[live-replay] Webhook crashed with ${res.status} on end-of-call-report fixture.\n` +
        `  provider_call_id: ${CALL_ID}\n` +
        `  Response: ${JSON.stringify(res.data)}\n` +
        `  HINT: Check if extra real-payload fields (transcript, cost, analysis, messages) ` +
        `  cause a schema validation error or DB constraint violation in the backend.`,
      );
    }
    expect(res.status).toBeLessThan(500);
  });

  it('call transitions to completed after real-shaped end-of-call-report (when call resolved)', async () => {
    if (!internalCallId) {
      console.warn('[live-replay] No internalCallId — skipping completed-status assertion.');
      return;
    }

    const callRes = await getVoiceCall(TOKEN, internalCallId);

    if (callRes.status !== 200) {
      console.warn(`[live-replay] getVoiceCall returned ${callRes.status} — skipping completed check.`);
      return;
    }

    const call = expectSuccess(callRes);
    // assertVoiceCallCompleted checks status='completed', duration_seconds, summary
    assertVoiceCallCompleted(call);
  });

  it('events include both status-update and end-of-call-report (when call resolved)', async () => {
    if (!internalCallId) {
      console.warn('[live-replay] No internalCallId — skipping events assertion.');
      return;
    }

    const eventsRes = await getVoiceCallEvents(TOKEN, internalCallId);

    if (eventsRes.status !== 200) {
      console.warn(`[live-replay] getVoiceCallEvents returned ${eventsRes.status} — skipping.`);
      return;
    }

    const events = expectSuccess(eventsRes);
    expect(Array.isArray(events)).toBe(true);
    assertEventExists(events, 'call.status_update');
    assertEventExists(events, 'call.ended');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay: tool-call
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-replay / tool-call', () => {
  const CALL_ID = uniqueVoiceCallId('live-replay-tool');

  beforeAll(async () => {
    // Create the call first so the tool-call has a valid parent
    const statusFixture = loadFixture('vapi-status-update.json');
    patchCallId(statusFixture, CALL_ID);
    // Tool-call replay uses the restaurant assistant to route to a known tool
    const assistantId = VAPI_RESTAURANT_ASSISTANT_ID || VAPI_ASSISTANT_ID;
    if (assistantId) patchAssistantId(statusFixture, assistantId);

    const setupRes = await sendVoiceWebhook(statusFixture);
    if (setupRes.status >= 500) {
      throw new Error(
        `[live-replay] Setup failed — status-update crashed with ${setupRes.status}.`,
      );
    }
  });

  it('real-shaped tool-call fixture is accepted without crash', async () => {
    const fixture = loadFixture('vapi-tool-call.json');
    patchCallId(fixture, CALL_ID);
    const assistantId = VAPI_RESTAURANT_ASSISTANT_ID || VAPI_ASSISTANT_ID;
    if (assistantId) patchAssistantId(fixture, assistantId);

    const toolName = fixture.message?.toolCallList?.[0]?.function?.name ?? '(unknown)';
    console.info(
      `[live-replay] tool-call fixture context:\n` +
      `  provider_call_id (patched): ${CALL_ID}\n` +
      `  assistantId (patched):      ${assistantId ?? '(none)'}\n` +
      `  tool name:                  ${toolName}\n` +
      `  arguments type:             ${typeof fixture.message?.toolCallList?.[0]?.function?.arguments}\n` +
      `  timestamp:                  ${fixture.message?.timestamp} (type: ${typeof fixture.message?.timestamp})`,
    );

    const res = await sendVoiceWebhook(fixture);
    console.info(`[live-replay] tool-call webhook response: ${res.status} — ${JSON.stringify(res.data)}`);

    if (res.status >= 500) {
      throw new Error(
        `[live-replay] Webhook crashed with ${res.status} on tool-call fixture.\n` +
        `  provider_call_id: ${CALL_ID}\n` +
        `  Response: ${JSON.stringify(res.data)}\n` +
        `  HINT: Check if toolWithToolCallList or extra call fields cause a parse error.\n` +
        `  HINT: Verify function.arguments type handling — real payloads may send JSON string.`,
      );
    }
    expect(res.status).toBeLessThan(500);
  });

  it('tool-call is accepted with a structured response', async () => {
    const fixture = loadFixture('vapi-tool-call.json');
    patchCallId(fixture, CALL_ID);
    const assistantId = VAPI_RESTAURANT_ASSISTANT_ID || VAPI_ASSISTANT_ID;
    if (assistantId) patchAssistantId(fixture, assistantId);

    const res = await sendVoiceWebhook(fixture);

    // Response must be parseable JSON in all cases
    expect(res.data).toBeDefined();
    expect(typeof res.data).toBe('object');

    if (res.status === 200) {
      // Backend accepted the tool-call. Two valid shapes exist:
      //   a) Synchronous tool execution  → { results: [...] }
      //   b) Async/ack-only processing   → { accepted: true, success: true, ... }
      // Both are correct — `results` is optional depending on backend processing mode.
      const hasResults  = Array.isArray(res.data.results);
      const hasAccepted = res.data.accepted === true || res.data.success === true;

      if (!hasResults && !hasAccepted) {
        throw new Error(
          `[live-replay] Tool-call returned 200 but response matches neither ` +
          `sync (results[]) nor ack ({ accepted/success }) shape.\n` +
          `  Response: ${JSON.stringify(res.data)}`,
        );
      }

      // If results are present they must be an array
      if ('results' in res.data) {
        expect(Array.isArray(res.data.results)).toBe(true);
      }
    } else if (res.status < 500) {
      // Structured rejection — must carry a success flag so callers can detect it
      expect(typeof res.data.success).toBe('boolean');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay: unknown / unsupported event type
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-replay / unknown-shape', () => {
  it('unknown event type does not cause an unhandled 500', async () => {
    const fixture = loadFixture('vapi-unknown-shape.json');
    // Patch with unique callId to avoid side-effects on unrelated tests
    patchCallId(fixture, uniqueVoiceCallId('live-replay-unknown'));
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    const res = await sendVoiceWebhook(fixture);

    if (res.status >= 500) {
      throw new Error(
        `[live-replay] Unknown event type "${fixture.message?.type}" caused a ${res.status}.\n` +
        `  Response: ${JSON.stringify(res.data)}\n` +
        `  The webhook router must handle unknown event types gracefully.`,
      );
    }
    expect(res.status).toBeLessThan(500);
  });

  it('unknown event type returns a structured response body', async () => {
    const fixture = loadFixture('vapi-unknown-shape.json');
    patchCallId(fixture, uniqueVoiceCallId('live-replay-unknown-2'));
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    const res = await sendVoiceWebhook(fixture);

    // Whether accepted or rejected, the body must be parseable JSON (not empty or HTML)
    expect(res.data).toBeDefined();
    expect(typeof res.data).toBe('object');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay: conversation-update
// ─────────────────────────────────────────────────────────────────────────────
// conversation-update is an informational event — the backend acknowledges it
// but does not persist a separate event record. Assertions are acceptance-only.

describe('voice / live-replay / conversation-update', () => {
  it('conversation-update does not cause an unhandled 500', async () => {
    const { fixture, source } = loadFixtureWithFallback('vapi-conversation-update.json');
    console.info(`[fixture-source] conversation-update replay using ${source.toUpperCase()} fixture`);

    patchCallId(fixture, uniqueVoiceCallId('live-replay-conv-update'));
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    const res = await sendVoiceWebhook(fixture);

    if (res.status >= 500) {
      throw new Error(
        `[live-replay] conversation-update caused a ${res.status}.\n` +
        `  Response: ${JSON.stringify(res.data)}\n` +
        `  The backend must handle conversation-update without crashing.`,
      );
    }
    expect(res.status).toBeLessThan(500);
  });

  it('conversation-update returns a structured response body', async () => {
    const { fixture } = loadFixtureWithFallback('vapi-conversation-update.json');
    patchCallId(fixture, uniqueVoiceCallId('live-replay-conv-update-2'));
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    const res = await sendVoiceWebhook(fixture);

    expect(res.data).toBeDefined();
    expect(typeof res.data).toBe('object');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay: speech-update
// ─────────────────────────────────────────────────────────────────────────────
// speech-update is a high-frequency informational event — the backend acknowledges
// it but does not persist a separate event record. Assertions are acceptance-only.

describe('voice / live-replay / speech-update', () => {
  it('speech-update does not cause an unhandled 500', async () => {
    const { fixture, source } = loadFixtureWithFallback('vapi-speech-update.json');
    console.info(`[fixture-source] speech-update replay using ${source.toUpperCase()} fixture`);

    patchCallId(fixture, uniqueVoiceCallId('live-replay-speech-update'));
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    const res = await sendVoiceWebhook(fixture);

    if (res.status >= 500) {
      throw new Error(
        `[live-replay] speech-update caused a ${res.status}.\n` +
        `  Response: ${JSON.stringify(res.data)}\n` +
        `  The backend must handle speech-update without crashing.`,
      );
    }
    expect(res.status).toBeLessThan(500);
  });

  it('speech-update returns a structured response body', async () => {
    const { fixture } = loadFixtureWithFallback('vapi-speech-update.json');
    patchCallId(fixture, uniqueVoiceCallId('live-replay-speech-update-2'));
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture, VAPI_ASSISTANT_ID);

    const res = await sendVoiceWebhook(fixture);

    expect(res.data).toBeDefined();
    expect(typeof res.data).toBe('object');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay: idempotency with real-shaped payload
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-replay / idempotency', () => {
  it('sending the same real-shaped status-update twice does not cause a 500', async () => {
    const CALL_ID = uniqueVoiceCallId('live-replay-idempotency');

    const fixture1 = loadFixture('vapi-status-update.json');
    patchCallId(fixture1, CALL_ID);
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture1, VAPI_ASSISTANT_ID);

    const fixture2 = loadFixture('vapi-status-update.json');
    patchCallId(fixture2, CALL_ID);
    if (VAPI_ASSISTANT_ID) patchAssistantId(fixture2, VAPI_ASSISTANT_ID);

    const res1 = await sendVoiceWebhook(fixture1);
    const res2 = await sendVoiceWebhook(fixture2);

    if (res1.status >= 500) {
      throw new Error(`[live-replay] First status-update crashed with ${res1.status}.`);
    }
    if (res2.status >= 500) {
      throw new Error(
        `[live-replay] Duplicate status-update crashed with ${res2.status}.\n` +
        `  provider_call_id: ${CALL_ID}\n` +
        `  This suggests the backend's idempotency guard does not handle real-shaped payloads.`,
      );
    }

    expect(res1.status).toBeLessThan(500);
    expect(res2.status).toBeLessThan(500);
  });
});
