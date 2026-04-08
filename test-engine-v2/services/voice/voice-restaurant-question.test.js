'use strict';

/**
 * Voice — Restaurant Question Flow
 *
 * Validates the menu question/FAQ flow in a single session:
 *   1. answer_menu_question → returns a knowledge or fallback answer
 *   2. persistence          → call, session, events exist and are consistent
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getCallSession,
  getVoiceCallEvents,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_RESTAURANT_ASSISTANT_ID,
} = require('../../core/factories');

const {
  expectSuccess,
  assertEventExists,
  expectUuid,
} = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(120000);

const TOKEN   = config.tokens.tenantA;
const CALL_ID = uniqueVoiceCallId('test-call-restaurant-question');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / question', () => {
  let internalCallId;

  beforeAll(async () => {
    const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID, {}, VAPI_RESTAURANT_ASSISTANT_ID));
    if (res.status >= 300) {
      throw new Error(
        `Setup failed — webhook rejected with ${res.status}.\n` +
        `provider_call_id: ${CALL_ID}\n` +
        `Response: ${JSON.stringify(res.data)}`,
      );
    }

    const list = await listVoiceCalls(TOKEN);
    if (list.status !== 200 || !list.data?.success) {
      throw new Error(`Setup failed — GET /voice/calls returned ${list.status}`);
    }
    const call = list.data.data.find((c) => c.provider_call_id === CALL_ID);
    if (!call) {
      throw new Error(
        `Setup failed — call not found in list after webhook.\n` +
        `provider_call_id: ${CALL_ID}`,
      );
    }
    internalCallId = call.id;
  });

  // ── Step 1: answer_menu_question ───────────────────────────────────────────

  it('step 1 — answer_menu_question returns answer for question', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(
        CALL_ID,
        'answer_menu_question',
        { question: 'Welche Pizza habt ihr?' },
        VAPI_RESTAURANT_ASSISTANT_ID,
      ),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`answer_menu_question failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(toolResult.question).toBe('Welche Pizza habt ihr?');
    expect(typeof toolResult.answer).toBe('string');
    expect(toolResult.answer.length).toBeGreaterThan(0);
    expect(['knowledge', 'fallback']).toContain(toolResult.source);

    // Stub answer must mention both pizza options
    expect(toolResult.answer).toContain('Margherita');
    expect(toolResult.answer).toContain('Salami');
  });

  // ── Step 2: call and session exist ────────────────────────────────────────

  it('step 2 — call and session exist with correct identifiers', async () => {
    const callRes = await getVoiceCall(TOKEN, internalCallId);
    const call    = expectSuccess(callRes);
    expect(call.id).toBe(internalCallId);
    expect(call.provider_call_id).toBe(CALL_ID);

    const sessionRes = await getCallSession(TOKEN, internalCallId);
    const session    = expectSuccess(sessionRes);
    expectUuid(session.id);
    expect(session.voice_call_id).toBe(internalCallId);
    expect(session.status).toBe('active');
  });

  // ── Step 3: events exist ──────────────────────────────────────────────────

  it('step 3 — events exist for status-update and tool invocation', async () => {
    const res    = await getVoiceCallEvents(TOKEN, internalCallId);
    const events = expectSuccess(res);

    expect(Array.isArray(events)).toBe(true);

    // status-update event(s) from call lifecycle must be present
    assertEventExists(events, 'call.status_update');

    // tool.invoked event — 'tool-calls' maps to 'tool.invoked' in the event mapper
    assertEventExists(events, 'tool.invoked');

    // 1 status-update + 1 tool-call = at least 2 persisted events
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
