'use strict';

/**
 * Voice — Booking / answer_booking_question
 *
 * Verifies that a VAPI tool-calls webhook invoking answer_booking_question
 * returns an answer from the knowledge service.
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
} = require('../../core/factories');

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN   = config.tokens.tenantA;
const CALL_ID = uniqueVoiceCallId('test-call-booking-question');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / booking / answer_booking_question', () => {
  let internalCallId;

  beforeAll(async () => {
    const res = await sendVoiceWebhook(buildVapiStatusUpdate(CALL_ID));
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

  it('tool-calls webhook with answer_booking_question → 200 with answer', async () => {
    const res = await sendVoiceWebhook(
      buildVapiToolCall(CALL_ID, 'answer_booking_question', {
        question: 'Wie kann ich einen Termin buchen?',
      }),
    );

    expect(res.status).toBe(200);

    const results = res.data?.results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const toolResult = results[0].result;
    if (toolResult.success !== true) {
      throw new Error(`Tool failed:\n${JSON.stringify(toolResult, null, 2)}`);
    }
    expect(toolResult.success).toBe(true);
    expect(typeof toolResult.answer).toBe('string');
  });
});
